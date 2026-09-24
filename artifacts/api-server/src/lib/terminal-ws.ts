import type { Server as HttpServer, IncomingMessage } from "http";
import type { Socket } from "net";
import { WebSocketServer, WebSocket } from "ws";
import { Client as SshClient } from "ssh2";
import net from "net";
import { unsign } from "cookie-signature";
import { db } from "@workspace/db";
import { sshHostsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sessionStore } from "./session.js";
import { decryptSecret } from "./crypto.js";
import { logger } from "./logger.js";

const TERMINAL_WS_PATH = "/api/terminal/ws";
const SESSION_COOKIE_NAME = "connect.sid";

function getCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface AuthedSession {
  userId: number;
  canAccessAiTerminal: boolean;
}

function getSessionFromRequest(request: IncomingMessage): Promise<AuthedSession | null> {
  return new Promise((resolve) => {
    const raw = getCookieValue(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!raw || !raw.startsWith("s:")) { resolve(null); return; }
    const sid = unsign(raw.slice(2), process.env.SESSION_SECRET ?? "");
    if (!sid) { resolve(null); return; }
    sessionStore.get(sid, (err, session) => {
      if (err || !session) { resolve(null); return; }
      const s = session as unknown as AuthedSession;
      if (!s.userId) { resolve(null); return; }
      resolve({ userId: s.userId, canAccessAiTerminal: !!s.canAccessAiTerminal });
    });
  });
}

// ---------------------------------------------------------------------------
// Minimal Telnet IAC (Interpret As Command) filter — strips negotiation and
// subnegotiation sequences from the stream shown to the user, and politely
// refuses every option the remote server proposes (WONT/DONT to everything).
// Good enough for interactive use with typical network gear over telnet.
// ---------------------------------------------------------------------------
const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;

class TelnetIacFilter {
  private state: "data" | "iac" | "cmd" | "sb" | "sbIac" = "data";
  private pendingCmd = 0;

  process(chunk: Buffer): { output: Buffer; responses: Buffer } {
    const out: number[] = [];
    const resp: number[] = [];
    for (const byte of chunk) {
      switch (this.state) {
        case "data":
          if (byte === IAC) this.state = "iac";
          else out.push(byte);
          break;
        case "iac":
          if (byte === IAC) { out.push(IAC); this.state = "data"; }
          else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) { this.pendingCmd = byte; this.state = "cmd"; }
          else if (byte === SB) { this.state = "sb"; }
          else { this.state = "data"; }
          break;
        case "cmd":
          if (this.pendingCmd === DO) resp.push(IAC, WONT, byte);
          else if (this.pendingCmd === WILL) resp.push(IAC, DONT, byte);
          this.state = "data";
          break;
        case "sb":
          if (byte === IAC) this.state = "sbIac";
          break;
        case "sbIac":
          this.state = byte === SE ? "data" : "sb";
          break;
      }
    }
    return { output: Buffer.from(out), responses: Buffer.from(resp) };
  }
}

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

function sendJson(ws: WebSocket, msg: object): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ---------------------------------------------------------------------------
// Terminal session registry — keeps a capped scrollback buffer per active
// connection so the Chat IA can read "what's already on screen" without
// needing to run a new command (and therefore without needing approval).
// Keyed by a client-generated sessionId, not the WS connection itself, so the
// chat endpoint (a separate HTTP request) can look it up by id.
// ---------------------------------------------------------------------------
const MAX_BUFFER_CHARS = 50_000;

interface TerminalSessionInfo {
  hostName: string;
  systemType: string;
  buffer: string;
}

const terminalSessions = new Map<string, TerminalSessionInfo>();

export function getTerminalSessionContext(sessionId: string): { hostName: string; systemType: string; buffer: string } | null {
  const s = terminalSessions.get(sessionId);
  return s ? { hostName: s.hostName, systemType: s.systemType, buffer: s.buffer } : null;
}

function registerTerminalSession(sessionId: string, hostName: string, systemType: string): void {
  terminalSessions.set(sessionId, { hostName, systemType, buffer: "" });
}

function appendToSessionBuffer(sessionId: string, text: string): void {
  const s = terminalSessions.get(sessionId);
  if (!s) return;
  s.buffer += text;
  if (s.buffer.length > MAX_BUFFER_CHARS) s.buffer = s.buffer.slice(-MAX_BUFFER_CHARS);
}

function unregisterTerminalSession(sessionId: string): void {
  terminalSessions.delete(sessionId);
}

async function bridgeSsh(
  ws: WebSocket,
  host: { ipAddress: string; port: number; username: string; passwordEncrypted: string },
  cols: number,
  rows: number,
  sessionId: string,
): Promise<void> {
  const client = new SshClient();
  const decoder = new TextDecoder("utf-8");

  client.on("ready", () => {
    client.shell({ term: "xterm-256color", cols, rows }, (err, stream) => {
      if (err) {
        sendJson(ws, { type: "status", status: "error", message: err.message });
        ws.close();
        return;
      }
      sendJson(ws, { type: "status", status: "connected" });

      stream.on("data", (data: Buffer) => {
        const text = decoder.decode(data, { stream: true });
        appendToSessionBuffer(sessionId, text);
        sendJson(ws, { type: "output", data: text });
      });
      stream.stderr.on("data", (data: Buffer) => {
        const text = decoder.decode(data, { stream: true });
        appendToSessionBuffer(sessionId, text);
        sendJson(ws, { type: "output", data: text });
      });
      stream.on("close", () => {
        sendJson(ws, { type: "status", status: "closed" });
        ws.close();
      });

      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as ClientMessage;
          if (msg.type === "input") stream.write(msg.data);
          else if (msg.type === "resize") stream.setWindow(msg.rows, msg.cols, 0, 0);
        } catch { /* ignore malformed client message */ }
      });
      ws.on("close", () => { stream.end(); client.end(); });
    });
  });

  client.on("error", (err) => {
    sendJson(ws, { type: "status", status: "error", message: err.message });
    ws.close();
  });

  client.connect({
    host: host.ipAddress,
    port: host.port,
    username: host.username,
    password: decryptSecret(host.passwordEncrypted),
    readyTimeout: 8000,
  });
}

function bridgeTelnet(
  ws: WebSocket,
  host: { ipAddress: string; port: number; username: string; passwordEncrypted: string },
  sessionId: string,
): void {
  const socket: Socket = net.createConnection({ host: host.ipAddress, port: host.port });
  const filter = new TelnetIacFilter();
  const decoder = new TextDecoder("utf-8");

  socket.on("connect", () => {
    sendJson(ws, { type: "status", status: "connected" });
  });

  socket.on("data", (data: Buffer) => {
    const { output, responses } = filter.process(data);
    if (responses.length > 0) socket.write(responses);
    if (output.length > 0) {
      const text = decoder.decode(output, { stream: true });
      appendToSessionBuffer(sessionId, text);
      sendJson(ws, { type: "output", data: text });
    }
  });

  socket.on("error", (err) => {
    sendJson(ws, { type: "status", status: "error", message: err.message });
    ws.close();
  });

  socket.on("close", () => {
    sendJson(ws, { type: "status", status: "closed" });
    ws.close();
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === "input") socket.write(msg.data);
      // Telnet resize (NAWS) isn't negotiated in this minimal client — most
      // legacy network gear over telnet doesn't require it to be usable.
    } catch { /* ignore malformed client message */ }
  });
  ws.on("close", () => { socket.destroy(); });
}

export function attachTerminalWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  // Heartbeat: detects ungracefully-dropped clients (laptop sleep, wifi drop,
  // browser crash) that never send a close frame, and force-closes them —
  // which in turn ends the underlying SSH/Telnet session on the remote host.
  const HEARTBEAT_INTERVAL_MS = 30_000;
  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as WebSocket & { isAlive?: boolean };
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on("close", () => clearInterval(heartbeatTimer));

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", "http://localhost");
    if (url.pathname !== TERMINAL_WS_PATH) return;

    void (async () => {
      const session = await getSessionFromRequest(request);
      if (!session || !session.canAccessAiTerminal) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const hostId = Number(url.searchParams.get("hostId"));
      if (!Number.isInteger(hostId)) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      const cols = Number(url.searchParams.get("cols")) || 80;
      const rows = Number(url.searchParams.get("rows")) || 24;
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, { hostId, cols, rows, sessionId });
      });
    })();
  });

  wss.on("connection", async (ws: WebSocket & { isAlive?: boolean }, _request: IncomingMessage, opts: { hostId: number; cols: number; rows: number; sessionId: string }) => {
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });

    const { hostId, cols, rows, sessionId } = opts;
    ws.on("close", () => unregisterTerminalSession(sessionId));

    try {
      const [host] = await db.select().from(sshHostsTable).where(eq(sshHostsTable.id, hostId)).limit(1);
      if (!host || !host.enabled) {
        sendJson(ws, { type: "status", status: "error", message: "Host não encontrado ou desativado." });
        ws.close();
        return;
      }

      registerTerminalSession(sessionId, host.name, host.systemType);

      if (host.protocol === "ssh") {
        await bridgeSsh(ws, host, cols, rows, sessionId);
      } else {
        bridgeTelnet(ws, host, sessionId);
      }
    } catch (err) {
      logger.error({ err, hostId }, "Failed to establish terminal bridge");
      sendJson(ws, { type: "status", status: "error", message: "Erro interno ao conectar." });
      ws.close();
    }
  });
}

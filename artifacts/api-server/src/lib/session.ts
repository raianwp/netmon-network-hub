import session, { MemoryStore } from "express-session";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}

// Exported separately so the WebSocket upgrade handler (terminal-session.ts) can
// look up a session by id without going through the full Express middleware chain.
export const sessionStore = new MemoryStore();

export const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // secure: true only when HTTPS is explicitly enabled via env var
    // For HTTP LAN deployments, must be false or browser discards the cookie
    secure: process.env.COOKIE_SECURE === "true",
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

declare module "express-session" {
  interface SessionData {
    userId: number;
    username: string;
    role: string;
    canAccessAiTerminal: boolean;
  }
}

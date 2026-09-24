import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startMonitoring, startPruneScheduler } from "./lib/monitoring.js";
import { startBackupScheduler } from "./lib/backup.js";
import { startInternetCheck } from "./lib/internet-check.js";
import { attachTerminalWebSocketServer } from "./lib/terminal-ws.js";
import { seedDefaultLlmModelsIfEmpty } from "./lib/llm-models-seed.js";
import { startAgentMonitoring } from "./lib/agent-monitoring.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  try {
    attachTerminalWebSocketServer(server);
  } catch (wsErr) {
    logger.error({ err: wsErr }, "Failed to attach terminal WebSocket server");
  }

  try {
    await seedDefaultLlmModelsIfEmpty();
  } catch (seedErr) {
    logger.error({ err: seedErr }, "Failed to seed default LLM models");
  }

  try {
    startMonitoring();
  } catch (monitorErr) {
    logger.error({ err: monitorErr }, "Failed to start monitoring service");
  }

  try {
    startBackupScheduler();
  } catch (backupErr) {
    logger.error({ err: backupErr }, "Failed to start backup scheduler");
  }

  try {
    startInternetCheck();
  } catch (internetErr) {
    logger.error({ err: internetErr }, "Failed to start internet check service");
  }

  try {
    startPruneScheduler();
  } catch (pruneErr) {
    logger.error({ err: pruneErr }, "Failed to start prune scheduler");
  }

  try {
    startAgentMonitoring();
  } catch (agentErr) {
    logger.error({ err: agentErr }, "Failed to start agent monitoring service");
  }
});

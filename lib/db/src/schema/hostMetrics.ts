import { pgTable, serial, integer, bigint, real, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { hostsTable } from "./hosts";

// One row per host — each scrape cycle UPSERTs this row in place rather than
// appending history, since the dashboard only ever needs the latest sample.
export const hostMetricsTable = pgTable("host_metrics", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id").notNull().unique().references(() => hostsTable.id, { onDelete: "cascade" }),
  collectedAt: timestamp("collected_at").defaultNow().notNull(),
  cpuPercent: real("cpu_percent"),
  cpuModel: text("cpu_model"),
  memUsedBytes: bigint("mem_used_bytes", { mode: "number" }),
  memTotalBytes: bigint("mem_total_bytes", { mode: "number" }),
  uptimeSeconds: bigint("uptime_seconds", { mode: "number" }),
  osVersion: text("os_version"),
  scrapeOk: boolean("scrape_ok").notNull(),
  processesJson: text("processes_json"),
});

export type HostMetric = typeof hostMetricsTable.$inferSelect;

import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { hostsTable } from "./hosts";

export const hostStatusesTable = pgTable("host_statuses", {
  id: serial("id").primaryKey(),
  hostId: integer("host_id").notNull().references(() => hostsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().$type<"online" | "offline" | "unknown">(),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  responseTimeMs: integer("response_time_ms"),
  consecutiveFailures: integer("consecutive_failures").default(0).notNull(),
}, (table) => [
  index("host_statuses_host_id_checked_at_idx").on(table.hostId, table.checkedAt),
]);

export type HostStatus = typeof hostStatusesTable.$inferSelect;

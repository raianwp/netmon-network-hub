import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hostsTable = pgTable("hosts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  type: text("type").notNull().$type<"pc" | "server" | "device">(),
  userName: text("user_name"),
  sector: text("sector"),
  enabled: boolean("enabled").default(true).notNull(),
  notifyDesktop: boolean("notify_desktop").default(false).notNull(),
  agentEnabled: boolean("agent_enabled").default(false).notNull(),
  agentPort: integer("agent_port").default(9182),
  orderIndex: integer("order_index").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastWentOnlineAt: timestamp("last_went_online_at"),
  lastWentOfflineAt: timestamp("last_went_offline_at"),
});

export const insertHostSchema = createInsertSchema(hostsTable).omit({ id: true, createdAt: true });
export type InsertHost = z.infer<typeof insertHostSchema>;
export type Host = typeof hostsTable.$inferSelect;

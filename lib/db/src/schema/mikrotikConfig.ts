import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mikrotikConfigTable = pgTable("mikrotik_config", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  apiUser: text("api_user").notNull(),
  apiPassword: text("api_password").notNull(),
  apiPort: integer("api_port").default(8728).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  refreshIntervalSeconds: integer("refresh_interval_seconds").default(30).notNull(),
});

export const insertMikrotikConfigSchema = createInsertSchema(mikrotikConfigTable).omit({ id: true });
export type InsertMikrotikConfig = z.infer<typeof insertMikrotikConfigSchema>;
export type MikrotikConfig = typeof mikrotikConfigTable.$inferSelect;

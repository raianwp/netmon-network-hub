import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sshHostsTable = pgTable("ssh_hosts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  protocol: text("protocol").notNull().$type<"ssh" | "telnet">(),
  port: integer("port").notNull(),
  username: text("username").notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  systemType: text("system_type").notNull().$type<"mikrotik" | "cisco" | "linux" | "windows" | "ubiquiti" | "fortinet" | "unknown">(),
  enabled: boolean("enabled").default(true).notNull(),
  orderIndex: integer("order_index").default(0).notNull(),
});

export const insertSshHostSchema = createInsertSchema(sshHostsTable).omit({ id: true });
export type InsertSshHost = z.infer<typeof insertSshHostSchema>;
export type SshHost = typeof sshHostsTable.$inferSelect;

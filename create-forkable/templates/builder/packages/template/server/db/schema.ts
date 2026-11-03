import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The app's database (D1 in preview and on Workers). Run `pnpm db:generate`
// after a change; the platform applies new migrations itself.

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

/** The One Connect reference per user (one short string, stored as given). */
export const connectUsers = sqliteTable("connect_users", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  reference: text("reference").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// App tables below.

import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const clipsTable = pgTable("clips", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  youtubeUrl: text("youtube_url").notNull(),
  videoTitle: text("video_title"),
  videoThumbnail: text("video_thumbnail"),
  startSec: real("start_sec").notNull(),
  endSec: real("end_sec").notNull(),
  startStr: text("start_str").notNull(),
  endStr: text("end_str").notNull(),
  quality: text("quality").notNull().default("720"),
  status: text("status").notNull().default("pending"),
  filePath: text("file_path"),
  sizeBytes: integer("size_bytes"),
  errorMsg: text("error_msg"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
});

export const insertClipSchema = createInsertSchema(clipsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertClip = z.infer<typeof insertClipSchema>;
export type Clip = typeof clipsTable.$inferSelect;

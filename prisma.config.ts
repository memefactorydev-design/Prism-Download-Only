import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 config: the datasource URL lives here (not in schema.prisma).
// dotenv loads .env explicitly — the Prisma CLI no longer does it automatically.
// Fall back so `prisma generate` never fails when only TURSO_* is set (or nothing
// is, at build time) — generate doesn't connect; the runtime adapter in
// src/lib/db.ts picks the real DB (Turso in serverless, file locally).
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL ?? "file:./dev.db",
  },
});

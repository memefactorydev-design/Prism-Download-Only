import { PrismaClient } from "@prisma/client";

// Prisma 7 connects through a driver adapter (no URL in schema.prisma). Provider
// stays "sqlite", so the same schema/migrations work everywhere:
//   • Local dev  → file DB via better-sqlite3 (DATABASE_URL=file:./dev.db)
//   • Serverless → Turso / libSQL (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN), since a
//     file DB can't be written on read-only serverless filesystems.
// Both adapters are kept out of the client bundle via serverExternalPackages.
function makeAdapter() {
  if (process.env.TURSO_DATABASE_URL) {
    // Note: the export is PrismaLibSql (lowercase "sql").
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSql } = require("@prisma/adapter-libsql");
    return new PrismaLibSql({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
  return new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = new PrismaClient({ adapter: makeAdapter() });
  return globalForPrisma.prisma;
}

// Lazy proxy: the real client (and its DB adapter) is only built on first use —
// at request time, never during the Next build's page-data collection.
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

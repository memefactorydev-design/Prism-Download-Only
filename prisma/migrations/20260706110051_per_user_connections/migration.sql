-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "encryptedToken" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Connection" ("createdAt", "encryptedToken", "id", "metadata", "provider", "status", "updatedAt") SELECT "createdAt", "encryptedToken", "id", "metadata", "provider", "status", "updatedAt" FROM "Connection";
DROP TABLE "Connection";
ALTER TABLE "new_Connection" RENAME TO "Connection";
CREATE UNIQUE INDEX "Connection_provider_userId_key" ON "Connection"("provider", "userId");
CREATE TABLE "new_Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "wonAt" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'meta',
    "name" TEXT,
    "notes" TEXT,
    "createdVia" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Deal" ("amount", "createdAt", "createdVia", "id", "name", "notes", "source", "wonAt") SELECT "amount", "createdAt", "createdVia", "id", "name", "notes", "source", "wonAt" FROM "Deal";
DROP TABLE "Deal";
ALTER TABLE "new_Deal" RENAME TO "Deal";
CREATE INDEX "Deal_wonAt_idx" ON "Deal"("wonAt");
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'post',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT,
    "body" TEXT NOT NULL,
    "hashtags" TEXT,
    "scheduledFor" DATETIME,
    "publishedAt" DATETIME,
    "postizPostId" TEXT,
    "createdBy" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Post" ("body", "channel", "createdAt", "createdBy", "errorMessage", "format", "hashtags", "id", "postizPostId", "publishedAt", "scheduledFor", "status", "title", "updatedAt") SELECT "body", "channel", "createdAt", "createdBy", "errorMessage", "format", "hashtags", "id", "postizPostId", "publishedAt", "scheduledFor", "status", "title", "updatedAt" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE TABLE "new_RoasSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "spend" REAL NOT NULL,
    "revenue" REAL,
    "roas" REAL,
    "impressions" INTEGER,
    "clicks" INTEGER,
    "raw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_RoasSnapshot" ("campaignId", "campaignName", "clicks", "createdAt", "date", "id", "impressions", "raw", "revenue", "roas", "spend") SELECT "campaignId", "campaignName", "clicks", "createdAt", "date", "id", "impressions", "raw", "revenue", "roas", "spend" FROM "RoasSnapshot";
DROP TABLE "RoasSnapshot";
ALTER TABLE "new_RoasSnapshot" RENAME TO "RoasSnapshot";
CREATE UNIQUE INDEX "RoasSnapshot_campaignId_date_userId_key" ON "RoasSnapshot"("campaignId", "date", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

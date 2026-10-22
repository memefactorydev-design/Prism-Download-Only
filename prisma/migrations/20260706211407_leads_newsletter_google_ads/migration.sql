-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "detail" TEXT,
    "score" INTEGER,
    "scoreReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "subscribed" BOOLEAN NOT NULL DEFAULT true,
    "lastTouch" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Newsletter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "audience" TEXT NOT NULL DEFAULT 'subscribed',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "sentAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RoasSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "network" TEXT NOT NULL DEFAULT 'meta',
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
INSERT INTO "new_RoasSnapshot" ("campaignId", "campaignName", "clicks", "createdAt", "date", "id", "impressions", "raw", "revenue", "roas", "spend", "userId") SELECT "campaignId", "campaignName", "clicks", "createdAt", "date", "id", "impressions", "raw", "revenue", "roas", "spend", "userId" FROM "RoasSnapshot";
DROP TABLE "RoasSnapshot";
ALTER TABLE "new_RoasSnapshot" RENAME TO "RoasSnapshot";
CREATE UNIQUE INDEX "RoasSnapshot_campaignId_date_userId_network_key" ON "RoasSnapshot"("campaignId", "date", "userId", "network");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Lead_userId_status_idx" ON "Lead"("userId", "status");

-- CreateIndex
CREATE INDEX "Lead_userId_createdAt_idx" ON "Lead"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Newsletter_userId_status_idx" ON "Newsletter"("userId", "status");

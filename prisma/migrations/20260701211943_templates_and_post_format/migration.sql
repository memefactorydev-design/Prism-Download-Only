-- CreateTable
CREATE TABLE "ContentTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "niche" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "blueprint" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "whyItWorks" TEXT,
    "captions" TEXT NOT NULL,
    "hashtags" TEXT NOT NULL,
    "youtubeTitle" TEXT,
    "evidence" TEXT,
    "score" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
INSERT INTO "new_Post" ("body", "channel", "createdAt", "createdBy", "errorMessage", "hashtags", "id", "postizPostId", "publishedAt", "scheduledFor", "status", "updatedAt") SELECT "body", "channel", "createdAt", "createdBy", "errorMessage", "hashtags", "id", "postizPostId", "publishedAt", "scheduledFor", "status", "updatedAt" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ContentTemplate_niche_createdAt_idx" ON "ContentTemplate"("niche", "createdAt");

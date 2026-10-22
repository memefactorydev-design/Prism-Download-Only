-- AlterTable
ALTER TABLE "GeneratedClip" ADD COLUMN "keywords" TEXT;
ALTER TABLE "GeneratedClip" ADD COLUMN "viralityRationale" TEXT;
ALTER TABLE "GeneratedClip" ADD COLUMN "viralityScore" INTEGER;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceAssetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "outputKinds" TEXT NOT NULL DEFAULT 'reel',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "transcript" TEXT,
    "captionStyle" TEXT NOT NULL DEFAULT 'bold',
    "reframe" TEXT NOT NULL DEFAULT 'center',
    "tightEdit" BOOLEAN NOT NULL DEFAULT false,
    "subjectTrack" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VideoJob" ("createdAt", "errorMessage", "id", "outputKinds", "progress", "sourceAssetId", "stage", "status", "transcript", "updatedAt") SELECT "createdAt", "errorMessage", "id", "outputKinds", "progress", "sourceAssetId", "stage", "status", "transcript", "updatedAt" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

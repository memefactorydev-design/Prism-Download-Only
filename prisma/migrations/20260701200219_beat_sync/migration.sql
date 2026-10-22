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
    "mode" TEXT NOT NULL DEFAULT 'single',
    "captions" BOOLEAN NOT NULL DEFAULT true,
    "musicAssetId" TEXT,
    "beatSync" BOOLEAN NOT NULL DEFAULT false,
    "beatCadence" INTEGER NOT NULL DEFAULT 2,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VideoJob" ("captionStyle", "captions", "createdAt", "errorMessage", "id", "mode", "musicAssetId", "outputKinds", "progress", "reframe", "sourceAssetId", "stage", "status", "subjectTrack", "tightEdit", "transcript", "updatedAt") SELECT "captionStyle", "captions", "createdAt", "errorMessage", "id", "mode", "musicAssetId", "outputKinds", "progress", "reframe", "sourceAssetId", "stage", "status", "subjectTrack", "tightEdit", "transcript", "updatedAt" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

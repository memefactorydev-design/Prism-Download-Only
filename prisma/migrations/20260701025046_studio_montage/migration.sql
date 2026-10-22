-- CreateTable
CREATE TABLE "VideoSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "transcript" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSecs" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VideoJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VideoJob" ("captionStyle", "createdAt", "errorMessage", "id", "outputKinds", "progress", "reframe", "sourceAssetId", "stage", "status", "subjectTrack", "tightEdit", "transcript", "updatedAt") SELECT "captionStyle", "createdAt", "errorMessage", "id", "outputKinds", "progress", "reframe", "sourceAssetId", "stage", "status", "subjectTrack", "tightEdit", "transcript", "updatedAt" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "VideoSource_jobId_index_idx" ON "VideoSource"("jobId", "index");

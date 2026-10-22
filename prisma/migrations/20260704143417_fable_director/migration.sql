-- CreateTable
CREATE TABLE "FableProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL DEFAULT 'Untitled cut',
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "plan" TEXT,
    "planVersion" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FableSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,
    "transcript" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSecs" REAL,
    "hasAudio" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "FableSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FableProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FableMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "planSnapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FableMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FableProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FableRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "quality" TEXT NOT NULL DEFAULT 'draft',
    "plan" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FableRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FableProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "captions" BOOLEAN NOT NULL DEFAULT true,
    "musicAssetId" TEXT,
    "beatSync" BOOLEAN NOT NULL DEFAULT false,
    "beatCadence" INTEGER NOT NULL DEFAULT 2,
    "voBrief" TEXT,
    "voVoiceId" TEXT,
    "effects" BOOLEAN NOT NULL DEFAULT true,
    "sfx" BOOLEAN NOT NULL DEFAULT true,
    "fableProjectId" TEXT,
    "fablePlan" TEXT,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "blueprint" TEXT,
    "templateTitle" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VideoJob" ("beatCadence", "beatSync", "blueprint", "captionStyle", "captions", "createdAt", "effects", "errorMessage", "id", "mode", "musicAssetId", "outputKinds", "progress", "reframe", "sfx", "sourceAssetId", "stage", "status", "subjectTrack", "templateTitle", "tightEdit", "transcript", "updatedAt", "voBrief", "voVoiceId") SELECT "beatCadence", "beatSync", "blueprint", "captionStyle", "captions", "createdAt", "effects", "errorMessage", "id", "mode", "musicAssetId", "outputKinds", "progress", "reframe", "sfx", "sourceAssetId", "stage", "status", "subjectTrack", "templateTitle", "tightEdit", "transcript", "updatedAt", "voBrief", "voVoiceId" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FableSource_projectId_index_idx" ON "FableSource"("projectId", "index");

-- CreateIndex
CREATE INDEX "FableMessage_projectId_createdAt_idx" ON "FableMessage"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FableRevision_projectId_number_key" ON "FableRevision"("projectId", "number");

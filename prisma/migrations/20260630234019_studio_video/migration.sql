-- CreateTable
CREATE TABLE "VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceAssetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "outputKinds" TEXT NOT NULL DEFAULT 'reel',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "transcript" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "GeneratedClip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "caption" TEXT,
    "sourceInMs" INTEGER,
    "sourceOutMs" INTEGER,
    "edl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "assetId" TEXT,
    "adIdeaId" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GeneratedClip_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "VideoJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GeneratedClip_jobId_kind_rank_idx" ON "GeneratedClip"("jobId", "kind", "rank");

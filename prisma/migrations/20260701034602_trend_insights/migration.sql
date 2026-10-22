-- CreateTable
CREATE TABLE "TrendInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "pacing" TEXT,
    "sound" TEXT,
    "whyItWorks" TEXT,
    "evidence" TEXT,
    "metrics" TEXT,
    "score" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TrendInsight_platform_createdAt_idx" ON "TrendInsight"("platform", "createdAt");

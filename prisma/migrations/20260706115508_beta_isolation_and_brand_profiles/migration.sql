-- CreateTable
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "whatYouSell" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "voice" TEXT,
    "region" TEXT,
    "goals" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdIdea" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "rank" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "evidence" TEXT,
    "brandAngle" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AdIdea" ("brandAngle", "createdAt", "evidence", "format", "hook", "id", "rank", "status", "targetAudience", "title") SELECT "brandAngle", "createdAt", "evidence", "format", "hook", "id", "rank", "status", "targetAudience", "title" FROM "AdIdea";
DROP TABLE "AdIdea";
ALTER TABLE "new_AdIdea" RENAME TO "AdIdea";
CREATE TABLE "new_ContentDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "excerpt" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "keywords" TEXT,
    "jsonLd" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "target" TEXT,
    "publishedUrl" TEXT,
    "sourceReportId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ContentDraft" ("bodyHtml", "createdAt", "excerpt", "id", "jsonLd", "keywords", "kind", "publishedUrl", "seoDescription", "seoTitle", "slug", "sourceReportId", "status", "target", "title", "updatedAt") SELECT "bodyHtml", "createdAt", "excerpt", "id", "jsonLd", "keywords", "kind", "publishedUrl", "seoDescription", "seoTitle", "slug", "sourceReportId", "status", "target", "title", "updatedAt" FROM "ContentDraft";
DROP TABLE "ContentDraft";
ALTER TABLE "new_ContentDraft" RENAME TO "ContentDraft";
CREATE TABLE "new_ContentTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_ContentTemplate" ("blueprint", "captions", "createdAt", "evidence", "format", "hashtags", "hook", "id", "niche", "rank", "score", "status", "title", "whyItWorks", "youtubeTitle") SELECT "blueprint", "captions", "createdAt", "evidence", "format", "hashtags", "hook", "id", "niche", "rank", "score", "status", "title", "whyItWorks", "youtubeTitle" FROM "ContentTemplate";
DROP TABLE "ContentTemplate";
ALTER TABLE "new_ContentTemplate" RENAME TO "ContentTemplate";
CREATE INDEX "ContentTemplate_niche_createdAt_idx" ON "ContentTemplate"("niche", "createdAt");
CREATE TABLE "new_FableProject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT 'Untitled cut',
    "status" TEXT NOT NULL DEFAULT 'preparing',
    "plan" TEXT,
    "planVersion" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_FableProject" ("createdAt", "errorMessage", "id", "plan", "planVersion", "status", "title", "updatedAt") SELECT "createdAt", "errorMessage", "id", "plan", "planVersion", "status", "title", "updatedAt" FROM "FableProject";
DROP TABLE "FableProject";
ALTER TABLE "new_FableProject" RENAME TO "FableProject";
CREATE TABLE "new_MediaAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageDriver" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSecs" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_MediaAsset" ("createdAt", "durationSecs", "height", "id", "mimeType", "originalName", "sizeBytes", "storageDriver", "storagePath", "width") SELECT "createdAt", "durationSecs", "height", "id", "mimeType", "originalName", "sizeBytes", "storageDriver", "storagePath", "width" FROM "MediaAsset";
DROP TABLE "MediaAsset";
ALTER TABLE "new_MediaAsset" RENAME TO "MediaAsset";
CREATE INDEX "MediaAsset_userId_createdAt_idx" ON "MediaAsset"("userId", "createdAt");
CREATE TABLE "new_Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'landing',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishTargets" TEXT,
    "publishedUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Site" ("createdAt", "id", "kind", "name", "publishTargets", "publishedUrl", "slug", "status", "updatedAt") SELECT "createdAt", "id", "kind", "name", "publishTargets", "publishedUrl", "slug", "status", "updatedAt" FROM "Site";
DROP TABLE "Site";
ALTER TABLE "new_Site" RENAME TO "Site";
CREATE UNIQUE INDEX "Site_slug_key" ON "Site"("slug");
CREATE TABLE "new_TrendInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_TrendInsight" ("createdAt", "evidence", "format", "hook", "id", "metrics", "pacing", "platform", "rank", "score", "sound", "title", "topic", "whyItWorks") SELECT "createdAt", "evidence", "format", "hook", "id", "metrics", "pacing", "platform", "rank", "score", "sound", "title", "topic", "whyItWorks" FROM "TrendInsight";
DROP TABLE "TrendInsight";
ALTER TABLE "new_TrendInsight" RENAME TO "TrendInsight";
CREATE INDEX "TrendInsight_platform_createdAt_idx" ON "TrendInsight"("platform", "createdAt");
CREATE TABLE "new_VideoJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL DEFAULT '',
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
INSERT INTO "new_VideoJob" ("beatCadence", "beatSync", "blueprint", "captionStyle", "captions", "createdAt", "draft", "effects", "errorMessage", "fablePlan", "fableProjectId", "id", "mode", "musicAssetId", "outputKinds", "progress", "reframe", "sfx", "sourceAssetId", "stage", "status", "subjectTrack", "templateTitle", "tightEdit", "transcript", "updatedAt", "voBrief", "voVoiceId") SELECT "beatCadence", "beatSync", "blueprint", "captionStyle", "captions", "createdAt", "draft", "effects", "errorMessage", "fablePlan", "fableProjectId", "id", "mode", "musicAssetId", "outputKinds", "progress", "reframe", "sfx", "sourceAssetId", "stage", "status", "subjectTrack", "templateTitle", "tightEdit", "transcript", "updatedAt", "voBrief", "voVoiceId" FROM "VideoJob";
DROP TABLE "VideoJob";
ALTER TABLE "new_VideoJob" RENAME TO "VideoJob";
CREATE INDEX "VideoJob_status_createdAt_idx" ON "VideoJob"("status", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_userId_key" ON "BrandProfile"("userId");

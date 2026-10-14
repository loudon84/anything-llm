CREATE TABLE "meeting_connections" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "meetings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connectionId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "activeKey" TEXT,
    "title" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME,
    "quarter" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL,
    "retrievalStatus" TEXT NOT NULL,
    "summary" TEXT,
    "transcript" TEXT,
    "coverage" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" DATETIME,
    "createdBy" INTEGER,
    "reviewedBy" INTEGER,
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meetings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "meeting_connections" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "meeting_sources" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentHash" TEXT,
    "activeHash" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "filePath" TEXT,
    "contentText" TEXT,
    "segments" TEXT,
    "parseStatus" TEXT NOT NULL,
    "error" TEXT,
    "deletedAt" DATETIME,
    "createdBy" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meeting_sources_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "meeting_chunks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "embedding" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_chunks_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "meeting_chunks_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "meeting_sources" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "meeting_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "meetingId" INTEGER,
    "connectionId" INTEGER,
    "externalId" TEXT,
    "activeKey" TEXT,
    "quarter" TEXT,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meeting_jobs_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "meeting_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "meeting_connections" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "meeting_conversations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingIds" TEXT NOT NULL,
    "workspaceIds" TEXT NOT NULL,
    "createdBy" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "meeting_answers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversationId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "text" TEXT,
    "missingInfo" TEXT,
    "citations" TEXT NOT NULL,
    "sourceState" TEXT NOT NULL,
    "previousAnswerId" INTEGER,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meeting_answers_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "meeting_conversations" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "meetings_activeKey_key" ON "meetings"("activeKey");
CREATE INDEX "meetings_quarter_deletedAt_idx" ON "meetings"("quarter", "deletedAt");
CREATE INDEX "meetings_connectionId_externalId_idx" ON "meetings"("connectionId", "externalId");
CREATE INDEX "meetings_retrievalStatus_reviewStatus_idx" ON "meetings"("retrievalStatus", "reviewStatus");
CREATE UNIQUE INDEX "meeting_sources_meetingId_activeHash_key" ON "meeting_sources"("meetingId", "activeHash");
CREATE INDEX "meeting_sources_meetingId_deletedAt_idx" ON "meeting_sources"("meetingId", "deletedAt");
CREATE INDEX "meeting_sources_contentHash_idx" ON "meeting_sources"("contentHash");
CREATE INDEX "meeting_chunks_meetingId_generation_idx" ON "meeting_chunks"("meetingId", "generation");
CREATE INDEX "meeting_chunks_sourceId_idx" ON "meeting_chunks"("sourceId");
CREATE UNIQUE INDEX "meeting_jobs_activeKey_key" ON "meeting_jobs"("activeKey");
CREATE INDEX "meeting_jobs_status_kind_idx" ON "meeting_jobs"("status", "kind");
CREATE INDEX "meeting_jobs_meetingId_status_idx" ON "meeting_jobs"("meetingId", "status");
CREATE INDEX "meeting_jobs_quarter_status_idx" ON "meeting_jobs"("quarter", "status");
CREATE INDEX "meeting_answers_conversationId_createdAt_idx" ON "meeting_answers"("conversationId", "createdAt");
CREATE INDEX "meeting_answers_previousAnswerId_idx" ON "meeting_answers"("previousAnswerId");

-- AlterTable
ALTER TABLE "meetings" ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "meeting_action_candidates" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "candidateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "originKey" TEXT,
    "sourceFingerprint" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceExcerpt" TEXT,
    "taskId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meeting_action_candidates_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "meeting_local_tasks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "meetingId" INTEGER NOT NULL,
    "candidateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assigneeKey" TEXT,
    "assigneeName" TEXT,
    "assigneeDepartment" TEXT,
    "dueAt" TEXT,
    "notes" TEXT,
    "createdBy" INTEGER,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "meeting_local_tasks_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "meeting_action_candidates_meetingId_candidateId_key" ON "meeting_action_candidates"("meetingId", "candidateId");

-- CreateIndex
CREATE INDEX "meeting_action_candidates_meetingId_status_idx" ON "meeting_action_candidates"("meetingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_local_tasks_idempotencyKey_key" ON "meeting_local_tasks"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_local_tasks_meetingId_candidateId_key" ON "meeting_local_tasks"("meetingId", "candidateId");

-- CreateIndex
CREATE INDEX "meeting_local_tasks_meetingId_status_idx" ON "meeting_local_tasks"("meetingId", "status");

CREATE TABLE "ProactiveTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "promptContext" TEXT,
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceMemoryIdsJson" TEXT NOT NULL DEFAULT '[]',
    "sourcePromiseIdsJson" TEXT NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProactiveTask_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProactiveTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProactiveTask_status_scheduledAt_idx" ON "ProactiveTask"("status", "scheduledAt");

CREATE INDEX "ProactiveTask_contactId_status_idx" ON "ProactiveTask"("contactId", "status");

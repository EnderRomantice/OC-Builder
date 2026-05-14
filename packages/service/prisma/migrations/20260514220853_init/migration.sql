-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "soulPath" TEXT,
    "modelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlatformAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "alias" TEXT,
    "handle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformAccountId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformAccountId" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "type" TEXT NOT NULL,
    "channel" TEXT,
    "text" TEXT,
    "rawJson" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT,
    "contactId" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT NOT NULL,
    "content" TEXT,
    "topicsJson" TEXT NOT NULL DEFAULT '[]',
    "emotionsJson" TEXT NOT NULL DEFAULT '[]',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "importance" REAL NOT NULL DEFAULT 0.5,
    "confidence" REAL NOT NULL DEFAULT 0.7,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Memory_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Memory_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryEvent" (
    "memoryId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'evidence',

    PRIMARY KEY ("memoryId", "eventId", "role"),
    CONSTRAINT "MemoryEvent_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MemoryLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromMemoryId" TEXT NOT NULL,
    "toMemoryId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryLink_fromMemoryId_fkey" FOREIGN KEY ("fromMemoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryLink_toMemoryId_fkey" FOREIGN KEY ("toMemoryId") REFERENCES "Memory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Promise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contactId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueAt" DATETIME,
    "fulfilledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Promise_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reflection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT,
    "contactId" TEXT,
    "scope" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reflection_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Reflection_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RetrievalLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestText" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL DEFAULT '{}',
    "resultJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_platform_accountId_key" ON "PlatformAccount"("platform", "accountId");

-- CreateIndex
CREATE INDEX "Contact_name_idx" ON "Contact"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_platformAccountId_externalId_key" ON "Contact"("platformAccountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_memoryId_key" ON "Contact"("memoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_platformAccountId_channel_externalId_key" ON "Conversation"("platformAccountId", "channel", "externalId");

-- CreateIndex
CREATE INDEX "Event_platformAccountId_occurredAt_idx" ON "Event"("platformAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_contactId_occurredAt_idx" ON "Event"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_conversationId_occurredAt_idx" ON "Event"("conversationId", "occurredAt");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE INDEX "Memory_contactId_type_status_idx" ON "Memory"("contactId", "type", "status");

-- CreateIndex
CREATE INDEX "Memory_importance_idx" ON "Memory"("importance");

-- CreateIndex
CREATE INDEX "Memory_updatedAt_idx" ON "Memory"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryLink_fromMemoryId_toMemoryId_relation_key" ON "MemoryLink"("fromMemoryId", "toMemoryId", "relation");

-- CreateIndex
CREATE INDEX "Promise_contactId_status_idx" ON "Promise"("contactId", "status");

-- CreateIndex
CREATE INDEX "Reflection_contactId_createdAt_idx" ON "Reflection"("contactId", "createdAt");

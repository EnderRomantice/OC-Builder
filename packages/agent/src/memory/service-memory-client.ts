import type { CharacterConfig, SocialMessageEvent } from "../core/types.js";

export interface ServiceContext {
    contactId: string;
    referencedContactIds: Array<{ label: string; contactId: string }>;
}

export interface ServiceMemoryRecord {
    id: string;
    type: string;
    summary: string;
    content?: string | null;
    topicsJson?: string;
    emotionsJson?: string;
    importance: number;
    confidence: number;
    createdAt?: string;
    updatedAt?: string;
}

interface ServiceEvent {
    id: string;
    type: string;
    text?: string | null;
    occurredAt: string;
}

interface ServicePromise {
    id: string;
    description: string;
    createdAt: string;
    status: string;
}

export interface ServiceProactiveTask {
    id: string;
    characterId?: string | null;
    contactId: string;
    type: string;
    reason: string;
    promptContext?: string | null;
    scheduledAt: string;
    status: string;
}

export interface CreateServiceProactiveTaskInput {
    characterId?: string;
    contactId: string;
    type: string;
    reason: string;
    promptContext?: string;
    scheduledAt: string;
    sourceMemoryIds?: string[];
    sourcePromiseIds?: string[];
}

export interface CreateServiceMemoryInput {
    characterId?: string;
    contactId: string;
    type: string;
    summary: string;
    content?: string;
    topics?: string[];
    emotions?: string[];
    metadata?: unknown;
    importance?: number;
    confidence?: number;
    sourceEventIds?: string[];
}

export interface ServiceMemoryDraft extends CreateServiceMemoryInput {
    contactId: string;
}

export interface ServiceMemoryPatch {
    summary?: string;
    content?: string;
    topics?: string[];
    emotions?: string[];
    metadata?: unknown;
    importance?: number;
    confidence?: number;
    sourceEventIds?: string[];
}

export type ServiceMemoryCurationInput =
    | {
        action: "create";
        reason?: string;
        memory: ServiceMemoryDraft;
    }
    | {
        action: "merge";
        reason?: string;
        targetMemoryId: string;
        patch: ServiceMemoryPatch;
    }
    | {
        action: "supersede";
        reason?: string;
        oldMemoryId: string;
        memory: ServiceMemoryDraft;
    }
    | {
        action: "ignore";
        reason?: string;
    };

export class ServiceMemoryClient {
    readonly baseUrl: string;

    constructor(baseUrl = process.env.OC_SERVICE_URL || "http://127.0.0.1:3001/api") {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }

    async prepareEvent(character: CharacterConfig, event: SocialMessageEvent): Promise<ServiceContext> {
        await this.post("/characters", {
            id: character.id,
            name: character.name,
            displayName: character.displayName,
            soulPath: character.soulPath,
            modelId: character.modelId
        });

        const contact = await this.post<any>("/contacts", {
            platform: event.platform,
            accountId: event.accountId,
            externalId: event.contact.id,
            memoryId: event.contact.memoryId,
            name: event.contact.name,
            alias: event.contact.alias,
            handle: event.contact.handle
        });

        await this.post("/events", {
            id: event.id,
            platform: event.platform,
            accountId: event.accountId,
            type: event.type,
            channel: event.channel,
            conversationExternalId: event.channel === "group" ? event.channelId : event.contact.id,
            contactExternalId: event.contact.id,
            contactMemoryId: event.contact.memoryId,
            contactName: event.contact.name,
            text: `User: ${event.text}`,
            raw: event.raw,
            occurredAt: event.receivedAt
        });

        const referencedContactIds: Array<{ label: string; contactId: string }> = [];
        const seen = new Set<string>([event.contact.id]);
        for (const mentioned of event.mentionedContacts || []) {
            if (seen.has(mentioned.id)) continue;
            seen.add(mentioned.id);
            const referenced = await this.post<any>("/contacts", {
                platform: event.platform,
                accountId: event.accountId,
                externalId: mentioned.id,
                memoryId: mentioned.memoryId,
                name: mentioned.name,
                alias: mentioned.alias,
                handle: mentioned.handle
            });
            referencedContactIds.push({ label: mentioned.name, contactId: referenced.id });
        }

        return { contactId: contact.id, referencedContactIds };
    }

    async recordAssistantMessage(event: SocialMessageEvent, text: string, targetChannel: "GROUP" | "PRIVATE" = "GROUP"): Promise<string> {
        const id = `${event.id}:assistant:${Date.now()}`;
        const channel = targetChannel === "PRIVATE" ? "private" : event.channel;
        await this.post("/events", {
            id,
            platform: event.platform,
            accountId: event.accountId,
            type: "message.sent",
            channel,
            conversationExternalId: channel === "group" ? event.channelId : event.contact.id,
            contactExternalId: event.contact.id,
            contactMemoryId: event.contact.memoryId,
            contactName: event.contact.name,
            text: `Assistant: ${text}`,
            occurredAt: new Date().toISOString()
        });
        return id;
    }

    async getUserProfile(contactId: string): Promise<string> {
        const memories = await this.searchMemories({ contactId, limit: 20 });
        if (memories.length === 0) return "No service memories for this contact.";

        return memories.map(memory => {
            const content = memory.content?.trim();
            return content
                ? `- ${memory.type}: ${memory.summary}\n  ${content}`
                : `- ${memory.type}: ${memory.summary}`;
        }).join("\n");
    }

    async searchMemories(input: {
        contactId: string;
        type?: string;
        status?: string;
        q?: string;
        topic?: string;
        limit?: number;
    }): Promise<ServiceMemoryRecord[]> {
        const params = new URLSearchParams({
            contactId: input.contactId,
            status: input.status || "active",
            limit: String(input.limit || 20)
        });

        if (input.type) params.set("type", input.type);
        if (input.q) params.set("q", input.q);
        if (input.topic) params.set("topic", input.topic);

        return this.get<ServiceMemoryRecord[]>(`/memories?${params.toString()}`);
    }

    async getRecentHistory(contactId: string, limit = 40): Promise<string> {
        const events = await this.get<ServiceEvent[]>(`/events?contactId=${encodeURIComponent(contactId)}&limit=${limit}`);
        if (events.length === 0) return "No persisted chat history.";

        return events
            .slice()
            .reverse()
            .map(event => `[${new Date(event.occurredAt).toISOString()}] ${event.text || event.type}`)
            .join("\n");
    }

    async getPendingTasks(contactId: string): Promise<string> {
        const promises = await this.get<ServicePromise[]>(`/promises?contactId=${encodeURIComponent(contactId)}&status=pending`);
        if (promises.length === 0) return "No pending tasks.";

        return promises
            .map(item => `- [ ] ${item.id}: ${item.description} (Created: ${item.createdAt.split("T")[0]})`)
            .join("\n");
    }

    async createPromise(contactId: string, description: string): Promise<void> {
        await this.post("/promises", { contactId, description });
    }

    async completePromise(id: string): Promise<void> {
        await this.patch(`/promises/${encodeURIComponent(id)}`, { status: "done" });
    }

    async createProactiveTask(input: CreateServiceProactiveTaskInput): Promise<void> {
        await this.post("/proactive-tasks", input);
    }

    async getDueProactiveTasks(limit = 20): Promise<ServiceProactiveTask[]> {
        const params = new URLSearchParams({
            status: "pending",
            dueBefore: new Date().toISOString(),
            limit: String(limit)
        });

        return this.get<ServiceProactiveTask[]>(`/proactive-tasks?${params.toString()}`);
    }

    async updateProactiveTask(id: string, input: { status?: string; lastError?: string | null; incrementAttempts?: boolean }): Promise<void> {
        await this.patch(`/proactive-tasks/${encodeURIComponent(id)}`, input);
    }

    async createProfileMemory(characterId: string, contactId: string, content: string, sourceEventIds: string[]): Promise<void> {
        await this.createMemory({
            characterId,
            contactId,
            type: "profile",
            summary: "Latest relationship profile",
            content,
            sourceEventIds,
            importance: 0.9,
            confidence: 0.8
        });
    }

    async createMemory(input: CreateServiceMemoryInput): Promise<void> {
        await this.post("/memories", input);
    }

    async curateMemory(input: ServiceMemoryCurationInput): Promise<void> {
        await this.post("/memories/curate", input);
    }

    private async get<T>(path: string): Promise<T> {
        return this.request<T>("GET", path);
    }

    private async post<T = unknown>(path: string, body: unknown): Promise<T> {
        return this.request<T>("POST", path, body);
    }

    private async patch<T = unknown>(path: string, body: unknown): Promise<T> {
        return this.request<T>("PATCH", path, body);
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2500);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method,
                headers: body === undefined ? undefined : { "content-type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`OC service ${method} ${path} failed: ${response.status} ${text}`);
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timeout);
        }
    }
}

export const serviceMemoryClient = new ServiceMemoryClient();

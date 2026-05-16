import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CharacterConfig, ContextPack, SocialMessageEvent } from "../core/types.js";
import { memoryManager } from "../memory/memory-manager.js";
import { memoryRetriever } from "../memory/memory-retriever.js";
import { serviceMemoryClient } from "../memory/service-memory-client.js";
import { taskManager } from "../memory/task-manager.js";

export class ContextBuilder {
    private readonly roomSessions = new Map<string, any[]>();
    private readonly relationshipSessions = new Map<string, any[]>();

    constructor(private readonly character: CharacterConfig) {}

    async build(event: SocialMessageEvent): Promise<ContextPack> {
        const roomKey = this.getRoomKey(event);
        const relationshipKey = this.getRelationshipKey(event);

        if (!this.roomSessions.has(roomKey)) this.roomSessions.set(roomKey, []);
        if (!this.relationshipSessions.has(relationshipKey)) this.relationshipSessions.set(relationshipKey, []);

        const fileProfile = memoryManager.getUserProfile(event.contact.memoryId);
        const fileHistory = memoryManager.getRecentHistory(event.contact.memoryId);
        const fileTasks = taskManager.formatTasksForPrompt(event.contact.memoryId);

        let serviceContactId: string | undefined;
        let userProfile = fileProfile;
        let recentHistory = fileHistory;
        let pendingTasks = fileTasks;
        let referencedProfiles = "";

        try {
            const serviceContext = await serviceMemoryClient.prepareEvent(this.character, event);
            serviceContactId = serviceContext.contactId;
            userProfile = (await memoryRetriever.retrieve(serviceContext.contactId, event)).text;
            referencedProfiles = await this.retrieveReferencedProfiles(serviceContext.referencedContactIds, event);
            recentHistory = event.channel === "group"
                ? "Group chat: contact-level persisted private history is withheld. Use the current room history and latest message only."
                : await serviceMemoryClient.getRecentHistory(serviceContext.contactId);
            pendingTasks = await serviceMemoryClient.getPendingTasks(serviceContext.contactId);
        } catch (e) {
            console.warn(`[MEMORY] Service unavailable, using file memory fallback: ${e instanceof Error ? e.message : String(e)}`);
        }

        return {
            event,
            soul: this.loadSoul(),
            userProfile,
            recentHistory,
            pendingTasks,
            serviceContactId,
            referencedProfiles,
            roomHistory: this.roomSessions.get(roomKey)!,
            relationshipHistory: this.relationshipSessions.get(relationshipKey)!
        };
    }

    appendResult(event: SocialMessageEvent, finalContent: string, targetChannel: "GROUP" | "PRIVATE") {
        const roomHistory = this.roomSessions.get(this.getRoomKey(event));
        const relationshipHistory = this.relationshipSessions.get(this.getRelationshipKey(event));
        const userMessage = {
            role: "user",
            content: event.segments.map(segment => `${segment.contact.name}: ${segment.text}`).join("\n")
        };
        const assistantMessage = { role: "assistant", content: finalContent };

        if (event.channel === "group") {
            roomHistory?.push(userMessage);
            if (targetChannel === "GROUP") {
                roomHistory?.push(assistantMessage);
            }
        } else {
            roomHistory?.push(userMessage, assistantMessage);
        }
        relationshipHistory?.push({ role: "user", content: event.text }, assistantMessage);

        this.trim(roomHistory);
        this.trim(relationshipHistory);
    }

    private loadSoul(): string {
        if (!existsSync(this.character.soulPath)) return `You are ${this.character.name}.`;

        const soul = readFileSync(this.character.soulPath, "utf8");
        const bubblePolicyPath = join(dirname(this.character.soulPath), "message-bubbles.md");
        if (!existsSync(bubblePolicyPath)) return soul;

        return `${soul}

---

${readFileSync(bubblePolicyPath, "utf8")}`;
    }

    private async retrieveReferencedProfiles(
        referencedContactIds: Array<{ label: string; contactId: string }>,
        event: SocialMessageEvent
    ): Promise<string> {
        if (referencedContactIds.length === 0) return "";

        const sections: string[] = [];
        for (const item of referencedContactIds.slice(0, 4)) {
            try {
                const retrieved = await memoryRetriever.retrieve(item.contactId, event);
                sections.push(`[${item.label}]\n${retrieved.text}`);
            } catch (e) {
                console.warn(`[MEMORY] Failed to retrieve referenced contact memory for ${item.label}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        return sections.join("\n\n");
    }

    private getRoomKey(event: SocialMessageEvent): string {
        return [
            this.character.id,
            event.platform,
            event.accountId,
            event.channel,
            event.channelId || event.contact.id
        ].join(":");
    }

    private getRelationshipKey(event: SocialMessageEvent): string {
        return [
            this.character.id,
            event.platform,
            event.accountId,
            event.contact.id
        ].join(":");
    }

    private trim(history?: any[]) {
        if (!history) return;
        while (history.length > 8) {
            history.splice(0, 2);
        }
    }
}

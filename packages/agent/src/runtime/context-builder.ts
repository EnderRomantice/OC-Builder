import { existsSync, readFileSync } from "node:fs";
import type { CharacterConfig, ContextPack, SocialMessageEvent } from "../core/types.js";
import { memoryManager } from "../memory/memory-manager.js";
import { taskManager } from "../memory/task-manager.js";

export class ContextBuilder {
    private readonly roomSessions = new Map<string, any[]>();
    private readonly relationshipSessions = new Map<string, any[]>();

    constructor(private readonly character: CharacterConfig) {}

    build(event: SocialMessageEvent): ContextPack {
        const roomKey = this.getRoomKey(event);
        const relationshipKey = this.getRelationshipKey(event);

        if (!this.roomSessions.has(roomKey)) this.roomSessions.set(roomKey, []);
        if (!this.relationshipSessions.has(relationshipKey)) this.relationshipSessions.set(relationshipKey, []);

        return {
            event,
            soul: this.loadSoul(),
            userProfile: memoryManager.getUserProfile(event.contact.memoryId),
            pendingTasks: taskManager.formatTasksForPrompt(event.contact.memoryId),
            roomHistory: this.roomSessions.get(roomKey)!,
            relationshipHistory: this.relationshipSessions.get(relationshipKey)!
        };
    }

    appendResult(event: SocialMessageEvent, finalContent: string) {
        const roomHistory = this.roomSessions.get(this.getRoomKey(event));
        const relationshipHistory = this.relationshipSessions.get(this.getRelationshipKey(event));
        const userMessage = {
            role: "user",
            content: event.segments.map(segment => `${segment.contact.name}: ${segment.text}`).join("\n")
        };
        const assistantMessage = { role: "assistant", content: finalContent };

        roomHistory?.push(userMessage, assistantMessage);
        relationshipHistory?.push({ role: "user", content: event.text }, assistantMessage);

        this.trim(roomHistory);
        this.trim(relationshipHistory);
    }

    private loadSoul(): string {
        return existsSync(this.character.soulPath)
            ? readFileSync(this.character.soulPath, "utf8")
            : `You are ${this.character.name}.`;
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

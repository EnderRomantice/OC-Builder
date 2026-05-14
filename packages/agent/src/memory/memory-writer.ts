import { memoryManager } from "./memory-manager.js";
import type { CharacterConfig, MemoryProposalAction, SocialMessageEvent } from "../core/types.js";

export class MemoryWriter {
    constructor(private readonly character: CharacterConfig) {}

    async writeInteraction(event: SocialMessageEvent, finalContent: string) {
        await memoryManager.appendHistory(
            event.contact.memoryId,
            `User: ${event.text}\n${this.character.displayName}: ${finalContent}`
        );
    }

    async applyProposal(proposal: MemoryProposalAction) {
        if (proposal.subject.characterId !== this.character.id) return;

        const existing = memoryManager.getUserProfile(this.toMemoryId(proposal));
        const next = [
            existing,
            "",
            `- ${proposal.memoryType}: ${proposal.content}`,
            `  Source: ${proposal.sourceEventIds.join(", ")}`,
            `  Confidence: ${proposal.confidence}`
        ].join("\n");
        memoryManager.updateUserProfile(this.toMemoryId(proposal), next);
    }

    private toMemoryId(proposal: MemoryProposalAction): string {
        const subject = proposal.subject;
        return [
            subject.characterId,
            subject.platform,
            subject.accountId,
            subject.contactId
        ].join("__");
    }
}

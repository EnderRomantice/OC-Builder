import OpenAI from "openai";
import type { CharacterConfig, SocialMessageEvent } from "../core/types.js";
import type { MemoryPromotion } from "./memory-promoter.js";
import type { ServiceMemoryCurationInput, ServiceMemoryRecord } from "../memory/service-memory-client.js";

export async function reviewMemoryPromotions(
    client: OpenAI,
    character: CharacterConfig,
    input: {
        event: SocialMessageEvent;
        serviceContactId: string;
        sourceEventIds: string[];
        promotions: MemoryPromotion[];
        existingMemories: ServiceMemoryRecord[];
    }
): Promise<ServiceMemoryCurationInput[]> {
    if (input.promotions.length === 0) return [];

    const allowedMemoryIds = new Set(input.existingMemories.map(memory => memory.id));
    const prompt = `
You are OC-Builder's MemoryReviewer.

Your job is to review candidate durable memories before they are written to storage.
Memory storage is asynchronous. Prefer quality over speed.

[CHARACTER]
ID: ${character.id}
Name: ${character.name}
Display Name: ${character.displayName}

[LATEST USER MESSAGE]
${input.event.text}

[CANDIDATE MEMORIES]
${JSON.stringify(input.promotions, null, 2)}

[EXISTING ACTIVE MEMORIES]
${JSON.stringify(input.existingMemories.map(memory => ({
        id: memory.id,
        type: memory.type,
        summary: memory.summary,
        content: memory.content,
        topicsJson: memory.topicsJson,
        emotionsJson: memory.emotionsJson,
        importance: memory.importance,
        confidence: memory.confidence
    })), null, 2)}

[DECISION RULES]
- create: use when the candidate is durable and not already represented.
- merge: use when an existing memory says the same thing or can be enriched without changing its meaning.
- supersede: use when the candidate updates or contradicts the current state of an existing memory, such as a changed preference, boundary, relationship state, or identity fact.
- ignore: use when the candidate is too weak, temporary, duplicated without useful new detail, or not durable.
- Never invent memory ids. targetMemoryId and oldMemoryId must come from EXISTING ACTIVE MEMORIES.
- For changed preferences or current relationship states, supersede the old memory instead of overwriting it.
- Return one decision per candidate memory at most.

[OUTPUT FORMAT]
Return ONLY valid JSON:
{
  "decisions": [
    {
      "action": "create | merge | supersede | ignore",
      "reason": "short reason",
      "targetMemoryId": "only for merge",
      "oldMemoryId": "only for supersede",
      "memory": {
        "type": "fact | preference | boundary | relationship_state_delta | emotional_milestone | promise",
        "summary": "short durable memory title",
        "content": "specific evidence-grounded durable memory",
        "topics": ["short", "tags"],
        "emotions": ["emotion labels if relevant"],
        "importance": 0.0,
        "confidence": 0.0
      },
      "patch": {
        "summary": "optional merged summary",
        "content": "optional merged content",
        "topics": ["optional", "merged", "tags"],
        "emotions": ["optional", "merged", "emotions"],
        "importance": 0.0,
        "confidence": 0.0
      }
    }
  ]
}
`;

    try {
        const response = await client.chat.completions.create({
            model: character.modelId,
            messages: [{ role: "system", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.1
        });

        const raw = response.choices[0].message.content || "";
        console.log(`[MEMORY] Raw review response: ${raw}`);
        const parsed = JSON.parse(stripJsonWrapper(raw));
        const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];

        return decisions
            .map((decision: any) => normalizeDecision(decision, {
                characterId: character.id,
                contactId: input.serviceContactId,
                sourceEventIds: input.sourceEventIds,
                allowedMemoryIds
            }))
            .filter((decision: ServiceMemoryCurationInput | null): decision is ServiceMemoryCurationInput => Boolean(decision));
    } catch (e) {
        console.warn(`[MEMORY] Review failed: ${e instanceof Error ? e.message : String(e)}`);
        return [];
    }
}

function normalizeDecision(
    value: any,
    context: {
        characterId: string;
        contactId: string;
        sourceEventIds: string[];
        allowedMemoryIds: Set<string>;
    }
): ServiceMemoryCurationInput | null {
    if (!value || typeof value.action !== "string") return null;

    if (value.action === "ignore") {
        return { action: "ignore", reason: stringOrUndefined(value.reason) };
    }

    if (value.action === "merge") {
        if (typeof value.targetMemoryId !== "string" || !context.allowedMemoryIds.has(value.targetMemoryId)) return null;
        const patch = normalizePatch(value.patch, context.sourceEventIds);
        if (!patch) return null;
        return {
            action: "merge",
            targetMemoryId: value.targetMemoryId,
            patch,
            reason: stringOrUndefined(value.reason)
        };
    }

    if (value.action === "create") {
        const memory = normalizeMemoryDraft(value.memory, context);
        if (!memory) return null;
        return {
            action: "create",
            memory,
            reason: stringOrUndefined(value.reason)
        };
    }

    if (value.action === "supersede") {
        if (typeof value.oldMemoryId !== "string" || !context.allowedMemoryIds.has(value.oldMemoryId)) return null;
        const memory = normalizeMemoryDraft(value.memory, context);
        if (!memory) return null;
        return {
            action: "supersede",
            oldMemoryId: value.oldMemoryId,
            memory,
            reason: stringOrUndefined(value.reason)
        };
    }

    return null;
}

function normalizeMemoryDraft(
    value: any,
    context: { characterId: string; contactId: string; sourceEventIds: string[] }
) {
    if (!value || typeof value.type !== "string" || typeof value.summary !== "string") return null;
    if (typeof value.content !== "string") return null;

    return {
        characterId: context.characterId,
        contactId: context.contactId,
        type: value.type,
        summary: value.summary,
        content: value.content,
        topics: stringArray(value.topics),
        emotions: stringArray(value.emotions),
        metadata: {},
        importance: numberOrDefault(value.importance, 0.5),
        confidence: numberOrDefault(value.confidence, 0.7),
        sourceEventIds: context.sourceEventIds
    };
}

function normalizePatch(value: any, sourceEventIds: string[]) {
    if (!value || typeof value !== "object") return null;

    return {
        summary: stringOrUndefined(value.summary),
        content: stringOrUndefined(value.content),
        topics: Array.isArray(value.topics) ? stringArray(value.topics) : undefined,
        emotions: Array.isArray(value.emotions) ? stringArray(value.emotions) : undefined,
        importance: numberOrUndefined(value.importance),
        confidence: numberOrUndefined(value.confidence),
        sourceEventIds
    };
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map(item => item.trim())
        : [];
}

function stringOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberOrDefault(value: unknown, fallback: number): number {
    return numberOrUndefined(value) ?? fallback;
}

function numberOrUndefined(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stripJsonWrapper(value: string): string {
    const trimmed = value.trim();
    if (trimmed.includes("```json")) {
        return trimmed.split("```json")[1].split("```")[0].trim();
    }
    if (trimmed.includes("```")) {
        return trimmed.split("```")[1].split("```")[0].trim();
    }
    return trimmed;
}

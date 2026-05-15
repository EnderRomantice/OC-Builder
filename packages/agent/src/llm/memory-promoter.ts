import OpenAI from "openai";
import type { CharacterConfig, SocialMessageEvent } from "../core/types.js";

export type MemoryPromotionType =
    | "fact"
    | "preference"
    | "boundary"
    | "relationship_state_delta"
    | "emotional_milestone"
    | "promise";

export interface MemoryPromotion {
    type: MemoryPromotionType;
    summary: string;
    content: string;
    topics: string[];
    emotions: string[];
    importance: number;
    confidence: number;
    reason: string;
}

export async function promoteMemories(
    client: OpenAI,
    character: CharacterConfig,
    input: {
        event: SocialMessageEvent;
        assistantText: string;
        userProfile: string;
        recentHistory: string;
    }
): Promise<MemoryPromotion[]> {
    const prompt = `
You are OC-Builder's MemoryPromoter.

Your job is NOT to chat. Your job is to decide whether the latest interaction should be promoted from raw event history into durable emotional memory.

[CHARACTER]
ID: ${character.id}
Name: ${character.name}
Display Name: ${character.displayName}

[CURRENT USER PROFILE / MEMORIES]
${input.userProfile}

[RECENT PERSISTED HISTORY]
${input.recentHistory}

[LATEST USER MESSAGE]
${input.event.text}

[LATEST ASSISTANT RESPONSE]
${input.assistantText}

[MEMORY TYPES]
- fact: stable user facts or identity info.
- preference: stable likes/dislikes/taste.
- boundary: explicit dislikes, red lines, safety/comfort boundaries.
- relationship_state_delta: trust, tension, intimacy, rupture, repair, or attitude changes between user and character.
- emotional_milestone: emotionally intense or relationship-defining episode worth recalling later.
- promise: explicit future commitment.

[PROMOTION RULES]
- Raw events are already stored. Promote only durable information that will matter in future conversations.
- Do not promote ordinary greetings, filler, or one-off temporary topics.
- Do not promote jokes as stable facts unless the user clearly repeats or confirms them.
- If the user tests memory, complains about hallucination, expresses disappointment, sets a boundary, or reveals strong emotion, strongly consider promotion.
- Prefer precise, evidence-grounded memories over broad personality labels.
- Use confidence below 0.65 for ambiguous or playful content.
- Return no more than 3 promotions.

[OUTPUT FORMAT]
Return ONLY valid JSON:
{
  "promotions": [
    {
      "type": "preference | fact | boundary | relationship_state_delta | emotional_milestone | promise",
      "summary": "short durable memory title",
      "content": "specific evidence-grounded durable memory",
      "topics": ["short", "tags"],
      "emotions": ["emotion labels if relevant"],
      "importance": 0.0,
      "confidence": 0.0,
      "reason": "why this should be retained"
    }
  ]
}
`;

    try {
        const response = await client.chat.completions.create({
            model: character.modelId,
            messages: [{ role: "system", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2
        });

        const raw = response.choices[0].message.content || "";
        console.log(`[MEMORY] Raw promotion response: ${raw}`);
        const parsed = JSON.parse(stripJsonWrapper(raw));
        const promotions = Array.isArray(parsed.promotions) ? parsed.promotions : [];

        return promotions
            .filter(isPromotion)
            .filter((item: MemoryPromotion) => item.importance >= 0.55 && item.confidence >= 0.65)
            .slice(0, 3);
    } catch (e) {
        console.warn(`[MEMORY] Promotion failed: ${e instanceof Error ? e.message : String(e)}`);
        return [];
    }
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

function isPromotion(value: any): value is MemoryPromotion {
    return value
        && typeof value.type === "string"
        && typeof value.summary === "string"
        && typeof value.content === "string"
        && Array.isArray(value.topics)
        && Array.isArray(value.emotions)
        && typeof value.importance === "number"
        && typeof value.confidence === "number";
}

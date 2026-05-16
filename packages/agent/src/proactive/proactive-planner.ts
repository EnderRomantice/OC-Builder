import OpenAI from "openai";
import type { ServiceContactRecord } from "../memory/service-memory-client.js";
import type { ProactivePlanDecision } from "./types.js";

export async function planProactiveTask(
    client: OpenAI,
    modelId: string,
    input: {
        soul: string;
        characterId: string;
        contact: ServiceContactRecord;
        userProfile: string;
        recentHistory: string;
        pendingTasks: string;
        now: string;
    }
): Promise<ProactivePlanDecision> {
    const recentEvents = (input.contact.events || [])
        .map(event => `[${new Date(event.occurredAt).toISOString()}] ${event.text || event.type}`)
        .join("\n") || "No recent events.";

    const prompt = `
${input.soul}

[ROLE]
You are the proactive planner for this character. You decide whether the character should initiate future contact.
The runtime wakes you periodically, but the character's soul decides actual timing, frequency, restraint, escalation, and whether silence matters.

[NOW]
${input.now}

[CONTACT]
Name: ${input.contact.name}

[RECENT EVENTS FOR THIS CONTACT]
${recentEvents}

[USER PROFILE & RELATIONSHIP]
${input.userProfile}

[RECENT PERSISTED CHAT HISTORY]
${input.recentHistory}

[PENDING PROMISES]
${input.pendingTasks}

[PLANNING RULES]
1. If the soul defines proactive behavior, follow it over generic politeness.
2. A clingy, possessive, or yandere persona may create frequent check-ins and escalate when ignored.
3. A careful persona should avoid unnecessary interruption and may schedule a later worried check-in.
4. Kaede should be thoughtful: if the user has not replied after a concerning exchange, she may worry about safety; otherwise she should not spam.
5. Do not create a task if there is no natural reason to contact this person.
6. If creating a task, schedule it in the future. Never schedule before [NOW].
7. The task is only a plan. The worker will make a final send/skip decision at execution time.

Return ONLY valid JSON:
{
  "shouldCreateTask": boolean,
  "type": "relationship_check_in | safety_check | reminder | follow_up | persona_initiated",
  "reason": "why this character would initiate",
  "promptContext": "short context for the future worker",
  "scheduledAt": "ISO timestamp"
}
`;

    const response = await client.chat.completions.create({
        model: modelId,
        messages: [{ role: "system", content: prompt }],
        temperature: 0.55
    });

    return normalizePlan(response.choices[0].message.content || "", input.now);
}

function normalizePlan(raw: string, now: string): ProactivePlanDecision {
    const fallback: ProactivePlanDecision = {
        shouldCreateTask: false,
        type: "relationship_check_in",
        reason: "No proactive task.",
        promptContext: "",
        scheduledAt: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString()
    };
    const json = extractJsonObject(raw);
    if (!json) return fallback;

    try {
        const value = JSON.parse(json);
        if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
        const scheduledAt = typeof value.scheduledAt === "string" ? value.scheduledAt : fallback.scheduledAt;
        const parsedTime = Date.parse(scheduledAt);
        return {
            shouldCreateTask: typeof value.shouldCreateTask === "boolean" ? value.shouldCreateTask : false,
            type: typeof value.type === "string" && value.type.trim() ? value.type.trim() : fallback.type,
            reason: typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : fallback.reason,
            promptContext: typeof value.promptContext === "string" ? value.promptContext.trim() : "",
            scheduledAt: Number.isFinite(parsedTime) && parsedTime > Date.parse(now)
                ? new Date(parsedTime).toISOString()
                : fallback.scheduledAt
        };
    } catch {
        return fallback;
    }
}

function extractJsonObject(raw: string): string | null {
    const trimmed = raw.trim();
    const start = trimmed.indexOf("{");
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index++) {
        const char = trimmed[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === "\\") {
            escaped = true;
            continue;
        }
        if (char === "\"") {
            inString = !inString;
            continue;
        }
        if (inString) continue;
        if (char === "{") depth++;
        if (char === "}") depth--;
        if (depth === 0) return trimmed.slice(start, index + 1);
    }

    return null;
}

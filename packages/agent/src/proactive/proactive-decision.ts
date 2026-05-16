import OpenAI from "openai";
import type { ProactiveDecision } from "./types.js";

export async function makeProactiveDecision(
    client: OpenAI,
    modelId: string,
    input: {
        soul: string;
        contactName: string;
        userProfile: string;
        recentHistory: string;
        pendingTasks: string;
        taskType: string;
        reason: string;
        promptContext?: string | null;
        scheduledAt: string;
    }
): Promise<ProactiveDecision> {
    const prompt = `
${input.soul}

[PROACTIVE TASK]
Type: ${input.taskType}
Scheduled At: ${input.scheduledAt}
Reason: ${input.reason}
Extra Context:
${input.promptContext || "None"}

[CONTACT]
Name: ${input.contactName}

[USER PROFILE & RELATIONSHIP]
${input.userProfile}

[RECENT PERSISTED CHAT HISTORY]
${input.recentHistory}

[PENDING TASKS]
${input.pendingTasks}

[RULES]
1. Decide whether this proactive task should send a private message now.
2. If the task is an explicit scheduled reminder requested by the user, usually send it.
3. If the task is a relationship check-in, send only if it feels natural and non-intrusive.
4. Keep the message short: normally under 60 Chinese characters, at most 2 short sentences.
5. Do not explain that you are a scheduled task or background worker.
6. Do not invent recent offline events.

Return ONLY valid JSON:
{
  "shouldSend": boolean,
  "content": "message text, empty if shouldSend is false",
  "reason": "short reason"
}
`;

    const response = await client.chat.completions.create({
        model: modelId,
        messages: [{ role: "system", content: prompt }],
        temperature: 0.6
    });

    const raw = response.choices[0].message.content || "";
    const parsed = parseDecision(raw);
    if (parsed) return parsed;

    return {
        shouldSend: false,
        content: "",
        reason: `Invalid proactive decision response: ${raw.slice(0, 200)}`
    };
}

function parseDecision(raw: string): ProactiveDecision | null {
    const json = extractJsonObject(raw);
    if (!json) return null;

    try {
        const value = JSON.parse(json);
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const shouldSend = typeof value.shouldSend === "boolean" ? value.shouldSend : false;
        const content = typeof value.content === "string" ? value.content.trim() : "";
        const reason = typeof value.reason === "string" ? value.reason.trim() : "No reason.";
        return { shouldSend, content, reason };
    } catch {
        return null;
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

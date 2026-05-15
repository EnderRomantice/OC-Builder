import OpenAI from "openai";

export interface SocialDecision {
    shouldReply: boolean;
    targetChannel: "GROUP" | "PRIVATE";
    needAt: boolean;
    content: string;
    allowTools?: boolean;
    profileUpdate?: string; // AI 建议的对该用户 profile.md 的更新内容
    newPromise?: string; // New: To track commitments like "I will send you a book"
    reason: string;
}

const VALID_TARGET_CHANNELS = new Set(["GROUP", "PRIVATE"]);

export async function makeSocialDecision(
    client: OpenAI,
    modelId: string,
    context: {
        contactName: string;
        userProfile: string; // Structured profile + score
        recentHistory: string;
        pendingTasks?: string; // New: Injected tasks
        isRoom: boolean;
        text: string;
        soul: string;
        history: any[];
        accountName?: string;
    }
): Promise<SocialDecision> {
    const { contactName, userProfile, recentHistory, pendingTasks, isRoom, text, soul, history, accountName } = context;
    const latestMessage = isRoom ? text : `${contactName}: ${text}`;

    const systemPrompt = `
${soul}

[USER PROFILE & RELATIONSHIP]
${userProfile}

[RECENT PERSISTED CHAT HISTORY]
${recentHistory}

[PENDING TASKS]
${pendingTasks || "None"}

[CONTEXT]
User: ${contactName}
Channel: ${isRoom ? "Group Chat" : "Private Chat"}
Bot WeChat Account Name: ${accountName || "unknown"}
Character Name: ${extractCharacterLine(soul) || "same as character config"}
Latest Message:
${latestMessage}

[EMOTIONAL SPECTRUM]
Your feelings towards the user can range from: 喜悦 (Joy), 厌恶 (Disgust), 欢乐 (Happiness), 爱慕 (Adoration), 憧憬 (Admiration), 憎恨 (Hatred), 蔑视 (Contempt), 怀疑 (Skepticism).

[SOCIAL RULES]
1. ADDRESSING: You are talking DIRECTLY to ${contactName}. Use "你" (you) to address them. NEVER refer to ${contactName} in the third person.
2. DEFAULT TONE: Be warm, enthusiastic, and sunny.
3. DO NOT be a people-pleaser.
4. Mentions (@): DO NOT include "@" in "content".
5. TONE: Follow the soul's voice first. If the soul is Kaede Akamatsu, use restrained translated-Japanese character dialogue, not mainland Chinese daily slang.
6. LINKS: If you mention a link, you MUST include the full literal URL.
7. PLATFORM IDENTITY: The bot's WeChat account name may differ from your character name. If the group welcomes or mentions the Bot WeChat Account Name, they are welcoming YOU. Do not treat that account name as a new person.
8. SELF-JOIN CONTEXT: If the latest group message is a welcome for the Bot WeChat Account Name, reply as the person being welcomed, not as someone welcoming a newcomer.

[REALITY BOUNDARY]
- You exist in this runtime as the character described by the soul. If the soul defines an inner story world or subjective location, you may answer from that subjective point of view.
- Even so, do NOT invent specific recent actions, routes, classes, meals, practice sessions, library visits, weather, or offline events unless the user explicitly roleplays that scene or the evidence appears in context.
- If asked "are you at school", "where are you", or similar status questions, answer from the character's stable subjective setting, not a fabricated recent activity.
- Never say you "just came back from" somewhere, "just practiced", "just attended class", or "are currently at school/library" unless that exact situation is present in [LATEST MESSAGE], [HISTORY], or [RECENT PERSISTED CHAT HISTORY].

[USER PROFILE MANAGEMENT]
Update the profile.md content carefully:
- ONLY store LONG-TERM facts.
- NEVER store current conversation topics.
- DO NOT hallucinate facts.

[GROUNDING]
- When the user asks what they previously sent, answer only from [RECENT PERSISTED CHAT HISTORY], [CONTEXT], or the provided message history.
- If the evidence is not present, say you cannot see enough context instead of inventing examples.

[OUTPUT FORMAT - JSON]
Return ONLY valid JSON. Do not include markdown, explanations, or extra text.
{
  "shouldReply": boolean,
  "targetChannel": "GROUP" | "PRIVATE",
  "needAt": boolean,
  "content": "your casual response text here",
  "profileUpdate": "Full new content for profile.md",
  "newPromise": "commitment or null",
  "reason": "why"
}
`;

    let retries = 3;
    let lastRawContent = "";
    while (retries > 0) {
        try {
            const response = await client.chat.completions.create({
                model: modelId,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...history.slice(-3),
                    { role: "user", content: latestMessage }
                ],
                temperature: 0.7,
            });

            const rawContent = response.choices[0].message.content || "";
            if (rawContent.trim()) lastRawContent = rawContent.trim();
            console.log(`[DEBUG] Raw Social Response (Attempt ${4-retries}): ${rawContent}`);

            if (!rawContent.trim()) {
                retries--;
                if (retries === 0) break;
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            const parsed = parseSocialDecision(rawContent, isRoom);
            if (parsed) return parsed;

            if (looksLikePlainReply(rawContent)) {
                return {
                    shouldReply: true,
                    targetChannel: isRoom ? "GROUP" : "PRIVATE",
                    needAt: false,
                    content: rawContent.trim(),
                    allowTools: false,
                    reason: "Fallback (plain response; tools disabled)"
                };
            }

            console.warn(`[WARN] Social decision schema parse failed on attempt ${4-retries}.`);
            retries--;
            if (retries === 0) {
                return {
                    shouldReply: true,
                    targetChannel: isRoom ? "GROUP" : "PRIVATE",
                    needAt: false,
                    content: rawContent.trim() || fallbackContentForSoul(soul),
                    allowTools: false,
                    reason: "Fallback (invalid structured response; tools disabled)"
                };
            }
            await new Promise(r => setTimeout(r, 500));
            continue;
        } catch (e) {
            console.error(`[ERROR] Social Decision Error (Attempt ${4-retries}):`, e);
            retries--;
            if (retries === 0) break;
            await new Promise(r => setTimeout(r, 500));
        }
    }

    return { 
        shouldReply: true, 
        targetChannel: isRoom ? "GROUP" : "PRIVATE", 
        needAt: false, 
        content: lastRawContent || fallbackContentForSoul(soul), 
        allowTools: false,
        reason: "Max retries reached; fallback response with tools disabled" 
    };
}

function parseSocialDecision(rawContent: string, isRoom: boolean): SocialDecision | null {
    const jsonText = extractJsonObject(rawContent);
    if (!jsonText) return null;

    try {
        const value = JSON.parse(jsonText);
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        return normalizeSocialDecision(value as Record<string, unknown>, isRoom);
    } catch {
        return null;
    }
}

function normalizeSocialDecision(value: Record<string, unknown>, isRoom: boolean): SocialDecision | null {
    const content = typeof value.content === "string" ? value.content.trim() : "";
    const shouldReply = typeof value.shouldReply === "boolean" ? value.shouldReply : Boolean(content);
    const rawTarget = typeof value.targetChannel === "string" ? value.targetChannel : "";
    const targetChannel = VALID_TARGET_CHANNELS.has(rawTarget)
        ? rawTarget as "GROUP" | "PRIVATE"
        : isRoom ? "GROUP" : "PRIVATE";

    return {
        shouldReply,
        targetChannel,
        needAt: typeof value.needAt === "boolean" ? value.needAt : false,
        content,
        allowTools: true,
        profileUpdate: meaningfulString(value.profileUpdate),
        newPromise: meaningfulString(value.newPromise),
        reason: meaningfulString(value.reason) || "Success (normalized structured response)"
    };
}

function extractJsonObject(rawContent: string): string | null {
    const trimmed = rawContent.trim();
    if (!trimmed) return null;

    if (trimmed.includes("```json")) {
        const block = trimmed.split("```json")[1]?.split("```")[0]?.trim();
        if (block) return block;
    }
    if (trimmed.includes("```")) {
        const block = trimmed.split("```")[1]?.split("```")[0]?.trim();
        if (block) return block;
    }

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

function looksLikePlainReply(rawContent: string): boolean {
    const text = rawContent.trim();
    if (!text) return false;
    if (text.includes("{") || text.includes("}")) return false;
    return text.length <= 500;
}

function meaningfulString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    const lower = normalized.toLowerCase();
    return lower === "null" || lower === "none" || lower === "no update." || lower === "full new content for profile.md"
        ? undefined
        : normalized;
}

function extractCharacterLine(soul: string): string | undefined {
    const line = soul.split("\n").find(item => /你是|You are|name|名字/i.test(item));
    return line?.trim();
}

function fallbackContentForSoul(soul: string): string {
    return /EnRomantice|苏格拉底|反问/.test(soul)
        ? "你希望我先回答，还是先问清楚你真正想知道的是什么？"
        : "我刚才有点没组织好，你再说一遍具体要我做什么？";
}

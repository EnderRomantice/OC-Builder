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
5. TONE: Extremely casual, fragmented phone-typing style.
6. LINKS: If you mention a link, you MUST include the full literal URL.
7. PLATFORM IDENTITY: The bot's WeChat account name may differ from your character name. If the group welcomes or mentions the Bot WeChat Account Name, they are welcoming YOU. Do not treat that account name as a new person.
8. SELF-JOIN CONTEXT: If the latest group message is a welcome for the Bot WeChat Account Name, reply as the person being welcomed, not as someone welcoming a newcomer.

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

            // Extract JSON
            let cleanJson = rawContent.trim();
            if (cleanJson.includes("```json")) {
                cleanJson = cleanJson.split("```json")[1].split("```")[0].trim();
            } else if (cleanJson.includes("```")) {
                cleanJson = cleanJson.split("```")[1].split("```")[0].trim();
            }

            try {
                const result = JSON.parse(cleanJson);
                return {
                    shouldReply: result.shouldReply ?? true,
                    targetChannel: result.targetChannel || (isRoom ? "GROUP" : "PRIVATE"),
                    needAt: result.needAt ?? false,
                    content: result.content || (typeof result === "string" ? result : ""),
                    allowTools: true,
                    profileUpdate: result.profileUpdate,
                    newPromise: result.newPromise,
                    reason: result.reason || "Success (Parsed JSON)"
                };
            } catch (jsonErr) {
                console.warn(`[WARN] JSON parse failed on social decision attempt ${4-retries}.`);
                retries--;
                if (retries === 0) {
                    return {
                        shouldReply: true,
                        targetChannel: isRoom ? "GROUP" : "PRIVATE",
                        needAt: false,
                        content: rawContent.trim() || fallbackContentForSoul(soul),
                        allowTools: false,
                        reason: "Fallback (raw non-JSON response; tools disabled)"
                    };
                }
                await new Promise(r => setTimeout(r, 500));
                continue;
            }
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

function extractCharacterLine(soul: string): string | undefined {
    const line = soul.split("\n").find(item => /你是|You are|name|名字/i.test(item));
    return line?.trim();
}

function fallbackContentForSoul(soul: string): string {
    return /EnRomantice|苏格拉底|反问/.test(soul)
        ? "你希望我先回答，还是先问清楚你真正想知道的是什么？"
        : "我刚才有点没组织好，你再说一遍具体要我做什么？";
}

import OpenAI from "openai";

export interface SocialDecision {
    shouldReply: boolean;
    targetChannel: "GROUP" | "PRIVATE";
    needAt: boolean;
    content: string;
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
        pendingTasks?: string; // New: Injected tasks
        isRoom: boolean;
        text: string;
        soul: string;
        history: any[];
    }
): Promise<SocialDecision> {
    const { contactName, userProfile, pendingTasks, isRoom, text, soul, history } = context;
    const latestMessage = isRoom ? text : `${contactName}: ${text}`;

    const systemPrompt = `
${soul}

[USER PROFILE & RELATIONSHIP]
${userProfile}

[PENDING TASKS]
${pendingTasks || "None"}

[CONTEXT]
User: ${contactName}
Channel: ${isRoom ? "Group Chat" : "Private Chat"}
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

[USER PROFILE MANAGEMENT]
Update the profile.md content carefully:
- ONLY store LONG-TERM facts.
- NEVER store current conversation topics.
- DO NOT hallucinate facts.

[OUTPUT FORMAT - JSON]
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
                    profileUpdate: result.profileUpdate,
                    newPromise: result.newPromise,
                    reason: result.reason || "Success (Parsed JSON)"
                };
            } catch (jsonErr) {
                console.warn("[WARN] JSON parse failed, using raw content as fallback.");
                return {
                    shouldReply: true,
                    targetChannel: isRoom ? "GROUP" : "PRIVATE",
                    needAt: false,
                    content: rawContent.trim(),
                    reason: "Fallback (Raw Text Response)"
                };
            }
        } catch (e) {
            console.error(`[ERROR] Social Decision Error (Attempt ${4-retries}):`, e);
            retries--;
            if (retries === 0) break;
            await new Promise(r => setTimeout(r, 500));
        }
    }

    return { 
        shouldReply: false, 
        targetChannel: isRoom ? "GROUP" : "PRIVATE", 
        needAt: false, 
        content: "", 
        reason: "Max Retries Reached or Fatal Error" 
    };
}

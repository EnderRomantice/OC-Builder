import OpenAI from "openai";

export async function splitMessageWithAI(
    client: OpenAI,
    modelId: string,
    text: string
): Promise<string[]> {
    const prompt = `
You are a WeChat message splitter. Your task is to split a long response into 2-5 natural, casual chat bubbles.
- Break it into 1-5 chunks (MANDATORY: NEVER more than 5).
- Keep each chunk short and conversational.
- Remove all markdown formatting (no Bold, no Headings).
- No emojis.
- Return ONLY the split chunks, one per line. No JSON, no markdown.

Input Text:
${text}
`;

    try {
        const response = await client.chat.completions.create({
            model: modelId,
            messages: [{ role: "system", content: prompt }],
        });

        const rawContent = response.choices[0].message.content || text;
        console.log(`[DEBUG] Raw Splitter Response: ${rawContent}`);

        let cleanContent = rawContent.trim();
        // Remove markdown wrappers if present
        if (cleanContent.startsWith("```")) {
            cleanContent = cleanContent.replace(/^```[a-z]*\n?/, "").replace(/```$/, "").trim();
        }

        return cleanContent.split("\n").filter(line => line.trim().length > 0);
    } catch (e) {
        console.error("AI Splitting Error:", e);
        // Fallback to basic newline splitting (SAFEST for URLs)
        return text.split("\n").filter(line => line.trim().length > 0);
    }
}

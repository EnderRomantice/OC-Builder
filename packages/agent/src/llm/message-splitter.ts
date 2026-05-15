import OpenAI from "openai";

export async function splitMessageWithAI(
    client: OpenAI,
    modelId: string,
    text: string
): Promise<string[]> {
    void client;
    void modelId;
    return splitMessageDeterministically(text);
}

function splitMessageDeterministically(text: string): string[] {
    const clean = text
        .replace(/\*\*/g, "")
        .replace(/^#{1,6}\s*/gm, "")
        .trim();
    if (!clean) return [];

    const explicitLines = clean.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const chunks: string[] = [];
    for (const line of explicitLines) {
        chunks.push(...splitLongLine(line, 90));
    }

    return chunks.slice(0, 5);
}

function splitLongLine(line: string, maxLength: number): string[] {
    if (line.length <= maxLength) return [line];

    const parts = line
        .split(/(?<=[。！？!?~～])\s*/)
        .map(part => part.trim())
        .filter(Boolean);
    if (parts.length <= 1) return [line];

    const chunks: string[] = [];
    let current = "";
    for (const part of parts) {
        if (!current) {
            current = part;
            continue;
        }
        if ((current + part).length > maxLength) {
            chunks.push(current);
            current = part;
        } else {
            current += part;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

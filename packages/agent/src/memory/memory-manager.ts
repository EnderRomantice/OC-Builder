import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface UserImpression {
    score: number; // 好感度 0-100
    emotionalState: string; // 当前情绪：喜悦、厌恶、爱慕、蔑视、憧憬等
    tags: string[]; 
    keyFacts: string[]; 
    lastUpdate: string;
}

export class MemoryManager {
    private baseDir: string;

    constructor() {
        this.baseDir = join(process.cwd(), "memory");
        if (!existsSync(this.baseDir)) mkdirSync(this.baseDir);
        
        const usersDir = join(this.baseDir, "users");
        if (!existsSync(usersDir)) mkdirSync(usersDir);

        const expDir = join(this.baseDir, "experience");
        if (!existsSync(expDir)) mkdirSync(expDir);
    }

    private getUserDir(contactId: string): string {
        const dir = join(this.baseDir, "users", contactId.replace(/[<>:"/\\|?*]/g, "_"));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        return dir;
    }

    // 1. 获取用户量化印象
    getUserProfile(contactId: string): string {
        const profilePath = join(this.getUserDir(contactId), "profile.md");
        if (existsSync(profilePath)) {
            return readFileSync(profilePath, "utf8");
        }
        return "好感度: 50/100 (初次见面)\n标签: []\n关键事实: 无";
    }

    // 2. 更新用户印象（支持 AI 结构化更新）
    updateUserProfile(contactId: string, profileContent: string) {
        const profilePath = join(this.getUserDir(contactId), "profile.md");
        writeFileSync(profilePath, profileContent);
    }

    // 3. 记录聊天片段并检查压缩
    async appendHistory(contactId: string, interaction: string, client?: any) {
        const historyPath = join(this.getUserDir(contactId), "chat_history.md");
        const timestamp = new Date().toLocaleString();
        const entry = `\n[${timestamp}]\n${interaction}\n---\n`;
        writeFileSync(historyPath, entry, { flag: "a" });

        // 检查文件大小是否超过 10KB
        try {
            const stats = readFileSync(historyPath);
            if (stats.length > 10 * 1024 && client) {
                console.log(`[MEMORY] History for ${contactId} is too long. Summarizing...`);
                await this.compressHistory(contactId, client);
            }
        } catch (e) {
            console.error("Compression error:", e);
        }
    }

    // 4. 压缩历史：将旧历史总结并存入 profile.md
    private async compressHistory(contactId: string, client: any) {
        const historyPath = join(this.getUserDir(contactId), "chat_history.md");
        const profilePath = join(this.getUserDir(contactId), "profile.md");
        const history = readFileSync(historyPath, "utf8");
        const profile = existsSync(profilePath) ? readFileSync(profilePath, "utf8") : "";

        const summaryPrompt = `
You are a memory archiver. Please summarize the following chat history between Kaede Akamatsu and a user.
Extract:
1. New key facts about the user.
2. Major events or feelings shared.
3. Keep the overall relationship score and emotional state context.

Existing Profile:
${profile}

Raw History to Summarize:
${history}

Output the NEW full profile.md content.
`;

        try {
            const response = await client.chat.completions.create({
                model: "deepseek-chat",
                messages: [{ role: "system", content: summaryPrompt }],
            });

            const newProfile = response.choices[0].message.content;
            if (newProfile) {
                writeFileSync(profilePath, newProfile);
                // 清空原始历史，只保留最后 500 字符作为衔接
                const transition = history.slice(-500);
                writeFileSync(historyPath, `--- History summarized on ${new Date().toLocaleString()} ---\n${transition}`);
                console.log(`[MEMORY] Successfully compressed history for ${contactId}`);
            }
        } catch (e) {
            console.error("Failed to compress history:", e);
        }
    }

    // 5. 记录全局经历
    logExperience(event: string) {
        const expPath = join(this.baseDir, "experience", "events.md");
        const timestamp = new Date().toLocaleString();
        writeFileSync(expPath, `[${timestamp}] ${event}\n`, { flag: "a" });
    }
}

export const memoryManager = new MemoryManager();

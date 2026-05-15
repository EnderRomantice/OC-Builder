import "dotenv/config";
import OpenAI from "openai";
import { WechatyBuilder } from "wechaty";
import { loadCharacterConfigs } from "./character/config.js";
import type { CharacterConfig } from "./core/types.js";
import { createWeChatMessageEvent, createWeChatRuntimeActions, type WeChatQueuedText, type WeChatRawMessage } from "./platforms/wechat.js";
import { CharacterRuntime } from "./runtime/character-runtime.js";
import { tools as agentTools } from "./tools/index.js";

const client = new OpenAI({
    apiKey: loadDeepSeekApiKey(),
    baseURL: process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
});

const characters = loadCharacterConfigs();
let sessions: BotSession[] = [];

process.on("uncaughtException", err => {
    console.error("[FATAL] Uncaught Exception:", err);
    if (isProtocolFailure(err)) {
        restartAll(err.message);
    }
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
    if (isProtocolFailure(reason)) {
        restartAll(String(reason));
    }
});

class BotSession {
    private bot: any;
    private runtime?: CharacterRuntime;
    private isRestarting = false;
    private errorCount = 0;
    private readonly messageQueues = new Map<string, { timer: NodeJS.Timeout | null; texts: WeChatQueuedText[]; latestRaw: WeChatRawMessage }>();

    constructor(
        private readonly ordinal: number,
        private readonly character: CharacterConfig
    ) {}

    async start() {
        this.bot = WechatyBuilder.build({
            name: this.wechatyName()
        });

        this.runtime = new CharacterRuntime({
            character: this.character,
            client,
            tools: agentTools,
            actions: createWeChatRuntimeActions(this.bot)
        });

        this.attachBotHandlers(this.bot);
        await this.bot.start();
        console.log(`${this.ordinal}. ${this.character.displayName}：started`);
    }

    async restart(reason: string) {
        if (this.isRestarting) return;
        this.isRestarting = true;
        console.log(`[SYSTEM] ${this.label()} protocol failure detected (${reason}). Rebuilding bot in 10s...`);

        try {
            await this.bot?.stop();
        } catch (e) {
            console.warn(`[SYSTEM] ${this.label()} bot stop failed during restart: ${e instanceof Error ? e.message : String(e)}`);
        }

        this.messageQueues.clear();

        setTimeout(() => {
            this.start()
                .catch(e => {
                    console.error(`[SYSTEM] ${this.label()} auto-restart failed:`, e instanceof Error ? e.message : String(e));
                })
                .finally(() => {
                    this.isRestarting = false;
                });
        }, 10000);
    }

    private attachBotHandlers(activeBot: any) {
        activeBot.on("scan", (qrcode: string, status: number) => {
            const link = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
            console.log(`${this.ordinal}. ${this.character.displayName}：${link}`);
            console.log(`[SCAN] ${this.label()} status ${status}`);
        });

        activeBot.on("login", (user: any) => {
            this.errorCount = 0;
            console.log(`${this.ordinal}. ${this.character.displayName}：logged in as ${user.name()}`);
        });

        activeBot.on("error", (error: Error) => {
            console.error(`[BOT ERROR] ${this.label()}:`, error.message);
            if (!isProtocolFailure(error)) return;

            this.errorCount++;
            if (this.errorCount >= 2) {
                console.error(`[SYSTEM] ${this.label()} persistent protocol error detected. Forcing restart...`);
                this.errorCount = 0;
                void this.restart(error.message);
            }
        });

        activeBot.on("message", async (message: any) => {
            try {
                if (message.self()) return;

                const contact = message.talker();
                const contactName = contact.name();
                const contactId = contact.id;
                const room = message.room();
                const roomId = room?.id;
                const text = message.text();

                const blacklist = ["微信支付", "微信团队", "文件传输助手", "腾讯新闻"];
                if (blacklist.includes(contactName) || contactName.includes("客服")) return;
                if (message.type() !== activeBot.Message.Type.Text) return;

                const queueKey = roomId || contactId;
                const latestRaw = { message, contact, room };
                if (!this.messageQueues.has(queueKey)) {
                    this.messageQueues.set(queueKey, { timer: null, texts: [], latestRaw });
                }
                const queue = this.messageQueues.get(queueKey)!;

                if (queue.timer) clearTimeout(queue.timer);
                queue.texts.push({ text, contact, message, timestamp: new Date().toISOString() });
                queue.latestRaw = latestRaw;

                queue.timer = setTimeout(async () => {
                    try {
                        const texts = queue.texts;
                        const raw = queue.latestRaw;
                        queue.texts = [];
                        queue.timer = null;

                        const event = await createWeChatMessageEvent(activeBot, raw, texts);
                        await this.runtime?.handleEvent(event);
                    } catch (e) {
                        console.error(`[BOT MESSAGE ERROR] ${this.label()}:`, e);
                        if (isProtocolFailure(e)) {
                            void this.restart(e instanceof Error ? e.message : String(e));
                        }
                    }
                }, 2500);
            } catch (e) {
                console.error(`[BOT MESSAGE ERROR] ${this.label()}:`, e);
                if (isProtocolFailure(e)) {
                    void this.restart(e instanceof Error ? e.message : String(e));
                }
            }
        });
    }

    private wechatyName(): string {
        const baseName = process.env.WECHATY_NAME || "pi-wechat-bot";
        if (characters.length === 1) return baseName;
        return `${baseName}-${this.ordinal}-${this.character.id}`;
    }

    private label(): string {
        return `${this.ordinal}. ${this.character.displayName}`;
    }
}

function loadDeepSeekApiKey(): string {
    const rawApiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
    const apiKey = rawApiKey.replace(/^Bearer\s+/i, "").trim();

    if (!apiKey) {
        console.error("[CONFIG] Missing DEEPSEEK_API_KEY. Copy .env.example to .env and set a DeepSeek API key.");
        process.exit(1);
    }

    if (!apiKey.startsWith("sk-")) {
        console.error("[CONFIG] Invalid DEEPSEEK_API_KEY. Set only the raw key, for example: DEEPSEEK_API_KEY=sk-...");
        console.error("[CONFIG] Do not include quotes, spaces, or the 'Bearer ' prefix.");
        process.exit(1);
    }

    return apiKey;
}

function isProtocolFailure(error: unknown): boolean {
    const message = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
    return [
        "-1 == 0",
        "1201 == 0",
        "状态同步",
        "Assertion",
        "socket hang up",
        "timeout",
        "Cannot read properties of undefined (reading 'start')",
        "Cannot read properties of undefined (reading 'batchGetContact')",
        "Cannot read properties of undefined (reading 'contacts')"
    ].some(pattern => message.includes(pattern));
}

function restartAll(reason: string) {
    for (const session of sessions) {
        void session.restart(reason);
    }
}

console.log(`[CONFIG] Starting ${characters.length} character session(s):`);
for (const [index, character] of characters.entries()) {
    console.log(`${index + 1}. ${character.displayName}：waiting for login link`);
}

sessions = characters.map((character, index) => new BotSession(index + 1, character));

for (const session of sessions) {
    session.start()
        .catch(e => {
            console.error("Bot initial start error:", e);
            void session.restart(e instanceof Error ? e.message : String(e));
        });
}

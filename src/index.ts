import "dotenv/config";
import OpenAI from "openai";
import { WechatyBuilder } from "wechaty";
import { loadCharacterConfig } from "./character/config.js";
import { createWeChatMessageEvent, createWeChatRuntimeActions, type WeChatQueuedText, type WeChatRawMessage } from "./platforms/wechat.js";
import { CharacterRuntime } from "./runtime/character-runtime.js";
import { tools as agentTools } from "./tools/index.js";

let isRestarting = false;
async function restartBot() {
    if (isRestarting) return;
    isRestarting = true;
    console.log("[SYSTEM] Protocol failure detected. Attempting to restart bot in 10s...");
    try {
        await bot.stop();
    } catch (e) {}

    setTimeout(() => {
        isRestarting = false;
        bot.start().catch(e => {
            console.error("[SYSTEM] Auto-restart failed, will try again next crash:", e.message);
        });
    }, 10000);
}

process.on("uncaughtException", err => {
    console.error("[FATAL] Uncaught Exception:", err);
    if (err.message.includes("状态同步") || err.message.includes("Assertion") || err.message.includes("socket hang up")) {
        restartBot();
    }
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
    if (String(reason).includes("Assertion") || String(reason).includes("timeout")) {
        restartBot();
    }
});

const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseURL: process.env.OPENAI_BASE_URL || "https://api.deepseek.com"
});

const character = loadCharacterConfig();
const messageQueues = new Map<string, { timer: NodeJS.Timeout | null; texts: WeChatQueuedText[]; latestRaw: WeChatRawMessage }>();

const bot = WechatyBuilder.build({
    name: process.env.WECHATY_NAME || "pi-wechat-bot"
});

const runtime = new CharacterRuntime({
    character,
    client,
    tools: agentTools,
    actions: createWeChatRuntimeActions(bot)
});

bot.on("scan", (qrcode, status) => {
    console.log(`Scan QR Code to login: ${status}\nhttps://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`);
});

bot.on("login", user => {
    console.log(`User ${user} logged in as ${user.name()}`);
});

let errorCount = 0;
bot.on("error", error => {
    console.error("[BOT ERROR]", error.message);
    if (error.message.includes("-1 == 0") || error.message.includes("状态同步")) {
        errorCount++;
        if (errorCount >= 2) {
            console.error("[SYSTEM] Persistent protocol error detected. Forcing restart...");
            errorCount = 0;
            restartBot();
        }
    }
});

bot.on("message", async message => {
    if (message.self()) return;

    const contact = message.talker();
    const contactName = contact.name();
    const contactId = contact.id;
    const room = message.room();
    const roomId = room?.id;
    const text = message.text();

    const blacklist = ["微信支付", "微信团队", "文件传输助手", "腾讯新闻"];
    if (blacklist.includes(contactName) || contactName.includes("客服")) return;
    if (message.type() !== bot.Message.Type.Text) return;

    const queueKey = roomId || contactId;
    const latestRaw = { message, contact, room };
    if (!messageQueues.has(queueKey)) {
        messageQueues.set(queueKey, { timer: null, texts: [], latestRaw });
    }
    const queue = messageQueues.get(queueKey)!;

    if (queue.timer) clearTimeout(queue.timer);
    queue.texts.push({ text, contact, message, timestamp: new Date().toISOString() });
    queue.latestRaw = latestRaw;

    queue.timer = setTimeout(async () => {
        const texts = queue.texts;
        const raw = queue.latestRaw;
        queue.texts = [];
        queue.timer = null;

        const event = await createWeChatMessageEvent(bot, raw, texts);
        await runtime.handleEvent(event);
    }, 2500);
});

bot.start()
    .then(() => console.log(`Bot started successfully for ${character.displayName}`))
    .catch(e => {
        console.error("Bot initial start error:", e);
        restartBot();
    });

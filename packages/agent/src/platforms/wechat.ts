import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { SendMessageAction, SocialMessageEvent, SocialRuntimeActions } from "../core/types.js";

export type WeChatRawMessage = {
    message: any;
    contact: any;
    room?: any;
};

export type WeChatQueuedText = {
    text: string;
    contact: any;
    message: any;
    timestamp: string;
};

export function createWeChatRuntimeActions(bot: any): SocialRuntimeActions {
    const privateMessageQueues = new Map<string, Promise<void>>();
    const outboundQueues = new Map<string, Promise<void>>();

    return {
        searchContacts: async query => {
            const contacts = await bot.Contact.findAll({ name: query });
            return Promise.all(contacts.map(async (contact: any) => ({
                id: contact.id,
                name: contact.name(),
                alias: await safeAlias(contact)
            })));
        },
        sendPrivateMessage: async (contactId, text) => {
            const target = await bot.Contact.find({ id: contactId });
            if (!target) return { success: false };
            const previous = privateMessageQueues.get(contactId) || Promise.resolve();
            const next = previous.catch(() => undefined).then(async () => {
                await target.say(text);
            });
            privateMessageQueues.set(contactId, next.finally(() => {
                if (privateMessageQueues.get(contactId) === next) {
                    privateMessageQueues.delete(contactId);
                }
            }));
            await next;
            return { success: true, label: target.name() };
        },
        sendMessage: async action => {
            const queueKey = [
                action.target.channel,
                action.target.roomId || action.target.contactId || ""
            ].join(":");
            const previous = outboundQueues.get(queueKey) || Promise.resolve();
            const next = previous.catch(() => undefined).then(async () => {
                await sendWechatMessage(bot, action);
            });
            outboundQueues.set(queueKey, next.finally(() => {
                if (outboundQueues.get(queueKey) === next) {
                    outboundQueues.delete(queueKey);
                }
            }));
            await next;
        }
    };
}

async function sendWechatMessage(bot: any, action: SendMessageAction) {
    const text = action.text.trim();
    const typingTime = 1000 + text.length * 180 + Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, typingTime));

    if (action.target.channel === "group" && action.target.roomId) {
        const room = await bot.Room.find({ id: action.target.roomId });
        if (!room) return;

        const mentionId = action.target.mentionContactIds?.[0];
        if (mentionId) {
            const contact = await bot.Contact.find({ id: mentionId });
            if (contact && typeof room.say === "function") {
                try {
                    await room.say(text, contact);
                    return;
                } catch (e) {}
            }
        }

        await room.say(text);
        return;
    }

    if (action.target.contactId) {
        const contact = await bot.Contact.find({ id: action.target.contactId });
        if (contact) await contact.say(text);
    }
}

export async function createWeChatMessageEvent(
    bot: any,
    raw: WeChatRawMessage,
    texts: WeChatQueuedText[]
): Promise<SocialMessageEvent> {
    const { contact, room } = raw;
    const contactId = contact.id;
    const contactName = contact.name();
    const alias = await safeAlias(contact);
    const handle = safeHandle(contact);
    const accountId = bot.currentUser?.id || "wechat";
    const accountName = bot.currentUser?.name?.() || "";
    const memoryId = ["wechat", accountId, contactId].join("__");
    const segments = await Promise.all(texts.map(async item => {
        const itemContactId = item.contact.id;
        const itemContactName = item.contact.name();
        const itemAlias = await safeAlias(item.contact);
        const itemHandle = safeHandle(item.contact);
        return {
            contact: {
                id: itemContactId,
                name: itemContactName,
                alias: itemAlias,
                handle: itemHandle,
                memoryId: ["wechat", accountId, itemContactId].join("__")
            },
            text: item.text,
            timestamp: item.timestamp
        };
    }));
    const text = segments.map(segment => `${segment.contact.name}: ${segment.text}`).join("\n");

    migrateLegacyMemory(contactId, memoryId);

    return {
        type: "message.received",
        id: texts.map(item => item.message.id).filter(Boolean).join(":") || `${Date.now()}-${contactId}`,
        platform: "wechat",
        accountId,
        receivedAt: new Date().toISOString(),
        channel: room ? "group" : "private",
        channelId: room?.id,
        accountName,
        contact: {
            id: contactId,
            name: contactName,
            alias,
            handle,
            memoryId
        },
        text,
        segments,
        raw
    };
}

function migrateLegacyMemory(contactId: string, memoryId: string) {
    const legacyPath = join(process.cwd(), "memory", "users", sanitizeId(contactId));
    const newPath = join(process.cwd(), "memory", "users", sanitizeId(memoryId));
    if (existsSync(legacyPath) && !existsSync(newPath) && legacyPath !== newPath) {
        console.log(`[MEMORY] Migrating legacy memory from ${contactId} to ${memoryId}`);
        try {
            renameSync(legacyPath, newPath);
        } catch (e) {
            console.error("[ERROR] Migration failed:", e);
        }
    }
}

function sanitizeId(id: string): string {
    return id.replace(/[<>:"/\\|?*]/g, "_");
}

async function safeAlias(contact: any): Promise<string> {
    try {
        return await contact.alias();
    } catch (e) {
        return "";
    }
}

function safeHandle(contact: any): string {
    try {
        return contact.handle?.() || "";
    } catch (e) {
        return "";
    }
}

import OpenAI from "openai";
import type { CharacterConfig, SendMessageAction, SocialEvent, SocialMessageEvent, SocialRuntimeActions } from "../core/types.js";
import { promoteMemories } from "../llm/memory-promoter.js";
import { reviewMemoryPromotions } from "../llm/memory-reviewer.js";
import { makeSocialDecision } from "../llm/social-decision.js";
import { splitMessageWithAI } from "../llm/message-splitter.js";
import { MemoryWriter } from "../memory/memory-writer.js";
import { serviceMemoryClient } from "../memory/service-memory-client.js";
import { taskManager } from "../memory/task-manager.js";
import type { AgentTool } from "../tools/types.js";
import { ActionDispatcher } from "./action-dispatcher.js";
import { AgentLoop } from "./agent-loop.js";
import { ContextBuilder } from "./context-builder.js";
import { ConversationScheduler } from "./conversation-scheduler.js";
import { EventInbox } from "./event-inbox.js";

export interface CharacterRuntimeOptions {
    character: CharacterConfig;
    client: OpenAI;
    tools: AgentTool<any>[];
    actions: SocialRuntimeActions;
}

export class CharacterRuntime {
    private readonly character: CharacterConfig;
    private readonly client: OpenAI;
    private readonly agentLoop: AgentLoop;
    private readonly inbox = new EventInbox();
    private readonly scheduler = new ConversationScheduler();
    private readonly contextBuilder: ContextBuilder;
    private readonly actionDispatcher: ActionDispatcher;
    private readonly memoryWriter: MemoryWriter;

    constructor(options: CharacterRuntimeOptions) {
        this.character = options.character;
        this.client = options.client;
        this.agentLoop = new AgentLoop(options);
        this.contextBuilder = new ContextBuilder(options.character);
        this.actionDispatcher = new ActionDispatcher(options.actions);
        this.memoryWriter = new MemoryWriter(options.character);
    }

    async handleEvent(event: SocialEvent) {
        const record = this.inbox.enqueue(event);
        if (record.status !== "pending") return;

        const result = await this.scheduler.scheduleLatest(event, async (scheduledEvent) => {
            this.inbox.markProcessing(scheduledEvent.id);
            try {
                if (scheduledEvent.type === "message.received") {
                    await this.processMessage(scheduledEvent);
                }
                this.inbox.markDone(scheduledEvent.id);
            } catch (e) {
                this.inbox.markFailed(scheduledEvent.id, e);
                throw e;
            }
        });
        if (result === "skipped") {
            this.inbox.markDone(event.id);
            console.log(`[SCHEDULER] Skipped stale event ${event.id}; newer message batch will be processed.`);
        }
    }

    async processMessage(event: SocialMessageEvent) {
        const contactName = event.contact.name;
        const memoryId = event.contact.memoryId;
        const context = await this.contextBuilder.build(event);
        const history = event.channel === "group"
            ? context.roomHistory.slice(-6)
            : context.relationshipHistory.slice(-8);

        try {
            if (this.isWelcomingBotSelf(event)) {
                const finalContent = `谢谢欢迎呀，我是${this.character.displayName}，之后请多指教`;
                const finalChunks = await splitMessageWithAI(this.client, this.character.modelId, finalContent);
                console.log(`[MSG] Sending ${finalChunks.length} self-welcome bubbles to ${contactName}`);
                for (const chunk of finalChunks) {
                    await this.dispatchMessage(event, chunk, false, "GROUP");
                }
                await this.persistAfterReply(event, finalContent, {}, {
                    serviceContactId: context.serviceContactId,
                    userProfile: context.userProfile,
                    recentHistory: context.recentHistory,
                    targetChannel: "GROUP"
                });
                this.contextBuilder.appendResult(event, finalContent, "GROUP");
                return;
            }

            const decision = await makeSocialDecision(this.client, this.character.modelId, {
                contactName,
                userProfile: context.userProfile,
                recentHistory: context.recentHistory,
                pendingTasks: context.pendingTasks,
                isRoom: event.channel === "group",
                text: event.text,
                soul: context.soul,
                history,
                accountName: event.accountName
            });

            if (!decision.shouldReply) {
                console.log(`[DEBUG] AI skipped: ${decision.reason}`);
                return;
            }

            const loopResult = decision.allowTools === false
                ? { content: decision.content, usedPrivateMessagingTool: false }
                : await this.agentLoop.run({
                    event,
                    soul: context.soul,
                    userProfile: context.userProfile,
                    recentHistory: context.recentHistory,
                    pendingTasks: context.pendingTasks,
                    serviceContactId: context.serviceContactId,
                    decision,
                    history
                });
            const finalContent = loopResult.content;
            const finalTargetChannel = loopResult.usedPrivateMessagingTool ? "PRIVATE" : decision.targetChannel;

            if (!finalContent) {
                console.warn(`[SYSTEM] AI failed to generate content for ${contactName}. Sending fallback...`);
                await this.dispatchMessage(event, "唔…刚才好像有点走神，没听清你刚才说了什么，能再跟我说一次吗？或者稍微等我一下下？", false, "GROUP");
                return;
            }

            const finalChunks = await splitMessageWithAI(this.client, this.character.modelId, finalContent);
            console.log(`[MSG] Sending ${finalChunks.length} bubbles to ${contactName}`);
            for (const chunk of finalChunks) {
                await this.dispatchMessage(event, chunk, decision.needAt, finalTargetChannel);
            }

            await this.persistAfterReply(event, finalContent, decision, {
                serviceContactId: context.serviceContactId,
                userProfile: context.userProfile,
                recentHistory: context.recentHistory,
                targetChannel: finalTargetChannel
            });
            this.contextBuilder.appendResult(event, finalContent, finalTargetChannel);
        } catch (e) {
            console.error("Agent Error:", e);
            throw e;
        }
    }

    private isWelcomingBotSelf(event: SocialMessageEvent): boolean {
        if (event.channel !== "group") return false;
        const accountName = event.accountName?.trim();
        if (!accountName) return false;
        const text = event.text.replace(/\s+/g, "");
        return text.includes(accountName)
            && /欢迎|加入|进群|新人|新朋友/.test(text);
    }

    private async dispatchMessage(
        event: SocialMessageEvent,
        text: string,
        needAt: boolean,
        targetChannel: "GROUP" | "PRIVATE"
    ) {
        const target = targetChannel === "PRIVATE"
            ? {
                platform: event.platform,
                accountId: event.accountId,
                channel: "private" as const,
                contactId: event.contact.id
            }
            : {
                platform: event.platform,
                accountId: event.accountId,
                channel: event.channel,
                contactId: event.channel === "private" ? event.contact.id : undefined,
                roomId: event.channel === "group" ? event.channelId : undefined,
                mentionContactIds: event.channel === "group" && needAt ? [event.contact.id] : undefined
            };

        const action: SendMessageAction = {
            type: "message.send",
            target,
            text,
            sourceEventId: event.id
        };
        await this.actionDispatcher.dispatch(action);
    }

    private hasMeaningfulMemoryValue(value?: string | null): value is string {
        if (!value) return false;
        const normalized = value.trim().toLowerCase();
        return normalized.length > 0
            && normalized !== "null"
            && normalized !== "none"
            && normalized !== "no update."
            && normalized !== "full new content for profile.md";
    }

    private async persistAfterReply(
        event: SocialMessageEvent,
        finalContent: string,
        decision: { newPromise?: string | null; profileUpdate?: string | null },
        context: { serviceContactId?: string; userProfile: string; recentHistory: string; targetChannel: "GROUP" | "PRIVATE" }
    ) {
        const memoryId = event.contact.memoryId;

        try {
            if (this.hasMeaningfulMemoryValue(decision.newPromise)) {
                if (context.serviceContactId) {
                    await serviceMemoryClient.createPromise(context.serviceContactId, decision.newPromise);
                } else {
                    taskManager.addTask(memoryId, decision.newPromise);
                }
            }

            let assistantEventId: string | undefined;
            if (context.serviceContactId) {
                assistantEventId = await serviceMemoryClient.recordAssistantMessage(event, finalContent, context.targetChannel);
                this.promoteAfterReply(event, finalContent, context.serviceContactId, [event.id, assistantEventId], context);
            } else if (this.hasMeaningfulMemoryValue(decision.profileUpdate)) {
                this.memoryWriter.updateProfile(memoryId, decision.profileUpdate.trim());
            }
        } catch (e) {
            console.warn(`[MEMORY] Service write failed after reply, preserving file memory fallback: ${e instanceof Error ? e.message : String(e)}`);
            if (this.hasMeaningfulMemoryValue(decision.newPromise)) {
                taskManager.addTask(memoryId, decision.newPromise);
            }
            if (this.hasMeaningfulMemoryValue(decision.profileUpdate)) {
                this.memoryWriter.updateProfile(memoryId, decision.profileUpdate.trim());
            }
        }

        await this.memoryWriter.writeInteraction(event, finalContent);
    }

    private promoteAfterReply(
        event: SocialMessageEvent,
        finalContent: string,
        serviceContactId: string,
        sourceEventIds: string[],
        context: { userProfile: string; recentHistory: string }
    ) {
        void promoteMemories(this.client, this.character, {
            event,
            assistantText: finalContent,
            userProfile: context.userProfile,
            recentHistory: context.recentHistory
        }).then(async promotions => {
            if (promotions.length === 0) {
                console.log("[MEMORY] No durable memories promoted.");
                return;
            }

            const existingMemories = await serviceMemoryClient.searchMemories({
                contactId: serviceContactId,
                limit: 50
            });
            const decisions = await reviewMemoryPromotions(this.client, this.character, {
                event,
                serviceContactId,
                sourceEventIds,
                promotions,
                existingMemories
            });

            if (decisions.length === 0) {
                console.log("[MEMORY] Review produced no durable memory writes.");
                return;
            }

            for (const decision of decisions) {
                await serviceMemoryClient.curateMemory(decision);
                console.log(`[MEMORY] Curated ${decision.action} for ${event.contact.name} (${event.contact.memoryId}, serviceContactId=${serviceContactId})`);
            }
        }).catch(e => {
            console.warn(`[MEMORY] Background memory review failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    }
}

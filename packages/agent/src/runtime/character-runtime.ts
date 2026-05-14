import OpenAI from "openai";
import type { CharacterConfig, SendMessageAction, SocialEvent, SocialMessageEvent, SocialRuntimeActions } from "../core/types.js";
import { makeSocialDecision } from "../llm/social-decision.js";
import { splitMessageWithAI } from "../llm/message-splitter.js";
import { MemoryWriter } from "../memory/memory-writer.js";
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

        await this.scheduler.schedule(event, async () => {
            this.inbox.markProcessing(event.id);
            try {
                if (event.type === "message.received") {
                    await this.processMessage(event);
                }
                this.inbox.markDone(event.id);
            } catch (e) {
                this.inbox.markFailed(event.id, e);
                throw e;
            }
        });
    }

    async processMessage(event: SocialMessageEvent) {
        const contactName = event.contact.name;
        const memoryId = event.contact.memoryId;
        const context = this.contextBuilder.build(event);
        const history = [...context.roomHistory.slice(-4), ...context.relationshipHistory.slice(-4)];

        try {
            const decision = await makeSocialDecision(this.client, this.character.modelId, {
                contactName,
                userProfile: context.userProfile,
                pendingTasks: context.pendingTasks,
                isRoom: event.channel === "group",
                text: event.text,
                soul: context.soul,
                history
            });

            if (!decision.shouldReply) {
                console.log(`[DEBUG] AI skipped: ${decision.reason}`);
                return;
            }

            const finalContent = await this.agentLoop.run({
                event,
                soul: context.soul,
                userProfile: context.userProfile,
                pendingTasks: context.pendingTasks,
                decision,
                history
            });

            if (!finalContent) {
                console.warn(`[SYSTEM] AI failed to generate content for ${contactName}. Sending fallback...`);
                await this.dispatchMessage(event, "唔…刚才好像有点走神，没听清你刚才说了什么，能再跟我说一次吗？或者稍微等我一下下？", false, "GROUP");
                return;
            }

            const finalChunks = await splitMessageWithAI(this.client, this.character.modelId, finalContent);
            console.log(`[MSG] Sending ${finalChunks.length} bubbles to ${contactName}`);
            for (const chunk of finalChunks) {
                await this.dispatchMessage(event, chunk, decision.needAt, decision.targetChannel);
            }

            if (decision.newPromise) {
                taskManager.addTask(memoryId, decision.newPromise);
            }

            await this.memoryWriter.writeInteraction(event, finalContent);
            this.contextBuilder.appendResult(event, finalContent);
        } catch (e) {
            console.error("Agent Error:", e);
        }
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
}

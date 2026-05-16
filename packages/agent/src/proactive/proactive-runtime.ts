import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import OpenAI from "openai";
import type { CharacterConfig, SendMessageAction, SocialMessageEvent, SocialRuntimeActions } from "../core/types.js";
import { splitMessageWithAI } from "../llm/message-splitter.js";
import { serviceMemoryClient, type ServiceContactRecord, type ServiceProactiveTask } from "../memory/service-memory-client.js";
import { ActionDispatcher } from "../runtime/action-dispatcher.js";
import { makeProactiveDecision } from "./proactive-decision.js";
import { planProactiveTask } from "./proactive-planner.js";

export interface ProactiveRuntimeOptions {
    character: CharacterConfig;
    client: OpenAI;
    actions: SocialRuntimeActions;
}

export class ProactiveRuntime {
    private readonly dispatcher: ActionDispatcher;
    private timer?: NodeJS.Timeout;
    private plannerTimer?: NodeJS.Timeout;
    private running = false;
    private planning = false;
    private stopped = true;
    private activeAccountId?: string;
    private readonly pollMs = Number(process.env.PROACTIVE_POLL_MS || 30000);
    private readonly plannerPollMs = Number(process.env.PROACTIVE_PLANNER_POLL_MS || 30 * 60 * 1000);
    private readonly plannerContactLimit = Number(process.env.PROACTIVE_PLANNER_CONTACT_LIMIT || 20);
    private readonly limit = Number(process.env.PROACTIVE_TASK_LIMIT || 10);
    private readonly modelId: string;

    constructor(private readonly options: ProactiveRuntimeOptions) {
        this.dispatcher = new ActionDispatcher(options.actions);
        this.modelId = process.env.PROACTIVE_MODEL || options.character.modelId;
    }

    start(accountId?: string) {
        if (!this.stopped) return;
        this.activeAccountId = accountId;
        this.stopped = false;
        console.log(`[PROACTIVE] ${this.options.character.displayName}: started with model ${this.modelId}`);
        void this.tick();
        void this.planTick();
    }

    stop() {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.plannerTimer) clearTimeout(this.plannerTimer);
        this.timer = undefined;
        this.plannerTimer = undefined;
        console.log(`[PROACTIVE] ${this.options.character.displayName}: stopped`);
    }

    private scheduleNext() {
        if (this.stopped) return;
        this.timer = setTimeout(() => void this.tick(), this.pollMs);
    }

    private scheduleNextPlan() {
        if (this.stopped) return;
        this.plannerTimer = setTimeout(() => void this.planTick(), this.plannerPollMs);
    }

    private async tick() {
        if (this.running) {
            this.scheduleNext();
            return;
        }

        this.running = true;
        try {
            const tasks = await serviceMemoryClient.getDueProactiveTasks(this.limit);
            for (const task of tasks) {
                if (this.stopped) break;
                if (task.characterId && task.characterId !== this.options.character.id) continue;
                await this.runTask(task);
            }
        } catch (e) {
            console.warn(`[PROACTIVE] Poll failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.running = false;
            this.scheduleNext();
        }
    }

    private async planTick() {
        if (this.planning) {
            this.scheduleNextPlan();
            return;
        }
        if (!this.activeAccountId) {
            this.scheduleNextPlan();
            return;
        }

        this.planning = true;
        try {
            const contacts = await serviceMemoryClient.listContacts({
                platform: "wechat",
                accountId: this.activeAccountId,
                limit: this.plannerContactLimit
            });
            for (const contact of contacts) {
                if (this.stopped) break;
                await this.planForContact(contact);
            }
        } catch (e) {
            console.warn(`[PROACTIVE] Planner failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.planning = false;
            this.scheduleNextPlan();
        }
    }

    private async planForContact(contact: ServiceContactRecord) {
        const existing = await serviceMemoryClient.getPendingProactiveTasks(contact.id, 1);
        const alreadyPlannedForCharacter = existing.some(task => !task.characterId || task.characterId === this.options.character.id);
        if (alreadyPlannedForCharacter) return;

        const userProfile = await serviceMemoryClient.getUserProfile(contact.id);
        const recentHistory = await serviceMemoryClient.getRecentHistory(contact.id);
        const pendingTasks = await serviceMemoryClient.getPendingTasks(contact.id);
        const now = new Date().toISOString();
        const plan = await planProactiveTask(this.options.client, this.modelId, {
            soul: this.loadSoul(),
            characterId: this.options.character.id,
            contact,
            userProfile,
            recentHistory,
            pendingTasks,
            now
        });

        if (!plan.shouldCreateTask) return;

        await serviceMemoryClient.createProactiveTask({
            characterId: this.options.character.id,
            contactId: contact.id,
            type: plan.type,
            reason: plan.reason,
            promptContext: plan.promptContext,
            scheduledAt: plan.scheduledAt
        });
        console.log(`[PROACTIVE] Planned ${plan.type} for ${contact.name} at ${plan.scheduledAt}: ${plan.reason}`);
    }

    private async runTask(task: ServiceProactiveTask) {
        try {
            await serviceMemoryClient.updateProactiveTask(task.id, { status: "running", incrementAttempts: true, lastError: null });

            const contact = await serviceMemoryClient.getContact(task.contactId);
            if (this.activeAccountId && contact.platformAccount.accountId !== this.activeAccountId) {
                await serviceMemoryClient.updateProactiveTask(task.id, { status: "pending", lastError: null });
                return;
            }
            const userProfile = await serviceMemoryClient.getUserProfile(task.contactId);
            const recentHistory = await serviceMemoryClient.getRecentHistory(task.contactId);
            const pendingTasks = await serviceMemoryClient.getPendingTasks(task.contactId);
            const decision = await makeProactiveDecision(this.options.client, this.modelId, {
                soul: this.loadSoul(),
                contactName: contact.name,
                userProfile,
                recentHistory,
                pendingTasks,
                taskType: task.type,
                reason: task.reason,
                promptContext: task.promptContext,
                scheduledAt: task.scheduledAt
            });

            if (!decision.shouldSend || !decision.content.trim()) {
                await serviceMemoryClient.updateProactiveTask(task.id, { status: "done", lastError: `Skipped: ${decision.reason}` });
                console.log(`[PROACTIVE] ${task.id} skipped: ${decision.reason}`);
                return;
            }

            const event = this.toSyntheticEvent(task, contact);
            const chunks = await splitMessageWithAI(this.options.client, this.options.character.modelId, decision.content);
            console.log(`[PROACTIVE] Sending ${chunks.length} bubble(s) to ${contact.name} for task ${task.id}`);
            for (const chunk of chunks) {
                await this.dispatchPrivate(event, contact, chunk);
            }
            await serviceMemoryClient.recordAssistantMessage(event, decision.content, "PRIVATE");
            await serviceMemoryClient.updateProactiveTask(task.id, { status: "done", lastError: null });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            const retryAt = new Date(Date.now() + this.retryDelayMs()).toISOString();
            await serviceMemoryClient.updateProactiveTask(task.id, {
                status: "pending",
                scheduledAt: retryAt,
                lastError: message
            });
            console.warn(`[PROACTIVE] Task ${task.id} failed; retry at ${retryAt}: ${message}`);
        }
    }

    private async dispatchPrivate(event: SocialMessageEvent, contact: ServiceContactRecord, text: string) {
        const action: SendMessageAction = {
            type: "message.send",
            sourceEventId: event.id,
            target: {
                platform: "wechat",
                accountId: contact.platformAccount.accountId,
                channel: "private",
                contactId: contact.externalId
            },
            text
        };
        await this.dispatcher.dispatch(action);
    }

    private toSyntheticEvent(task: ServiceProactiveTask, contact: ServiceContactRecord): SocialMessageEvent {
        return {
            type: "message.received",
            id: `proactive:${task.id}`,
            platform: "wechat",
            accountId: contact.platformAccount.accountId,
            receivedAt: new Date().toISOString(),
            channel: "private",
            accountName: contact.platformAccount.label || undefined,
            contact: {
                id: contact.externalId,
                name: contact.name,
                alias: contact.alias || undefined,
                handle: contact.handle || undefined,
                memoryId: contact.memoryId
            },
            text: `[Proactive task] ${task.reason}`,
            segments: [{
                contact: {
                    id: contact.externalId,
                    name: contact.name,
                    alias: contact.alias || undefined,
                    handle: contact.handle || undefined,
                    memoryId: contact.memoryId
                },
                text: `[Proactive task] ${task.reason}`,
                timestamp: new Date().toISOString()
            }],
            raw: { proactiveTaskId: task.id }
        };
    }

    private loadSoul(): string {
        const soulPath = this.options.character.soulPath;
        if (!existsSync(soulPath)) return `You are ${this.options.character.name}.`;

        const soul = readFileSync(soulPath, "utf8");
        const bubblePolicyPath = join(dirname(soulPath), "message-bubbles.md");
        if (!existsSync(bubblePolicyPath)) return soul;

        return `${soul}

---

${readFileSync(bubblePolicyPath, "utf8")}`;
    }

    private retryDelayMs(): number {
        return Number(process.env.PROACTIVE_RETRY_MS || 5 * 60 * 1000);
    }
}

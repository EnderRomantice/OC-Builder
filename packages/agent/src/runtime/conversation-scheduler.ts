import type { SocialEvent, SocialMessageEvent } from "../core/types.js";

type Task = (event: SocialEvent) => Promise<void>;
type ScheduleResult = "completed" | "skipped";

interface ScheduledTask {
    event: SocialEvent;
    task: Task;
    resolve: (result: ScheduleResult) => void;
    reject: (error: unknown) => void;
}

interface QueueState {
    running: boolean;
    pending?: ScheduledTask;
}

export class ConversationScheduler {
    private readonly queues = new Map<string, QueueState>();

    constructor(private readonly coalesceMs = Number(process.env.AGENT_MESSAGE_COALESCE_MS || 3500)) {}

    scheduleLatest(event: SocialEvent, task: Task): Promise<ScheduleResult> {
        const key = this.getQueueKey(event);
        let state = this.queues.get(key);
        if (!state) {
            state = { running: false };
            this.queues.set(key, state);
        }

        return new Promise((resolve, reject) => {
            const scheduled: ScheduledTask = { event, task, resolve, reject };
            if (state.running) {
                if (state.pending) {
                    scheduled.event = this.mergeEvents(state.pending.event, event);
                    state.pending.resolve("skipped");
                }
                state.pending = scheduled;
                return;
            }

            state.running = true;
            void this.runLoop(key, state, scheduled);
        });
    }

    private async runLoop(key: string, state: QueueState, scheduled: ScheduledTask) {
        let current: ScheduledTask | undefined = scheduled;
        while (current) {
            try {
                await current.task(current.event);
                current.resolve("completed");
            } catch (e) {
                current.reject(e);
            }

            if (!state.pending) {
                state.running = false;
                if (this.queues.get(key) === state) this.queues.delete(key);
                return;
            }

            await new Promise(resolve => setTimeout(resolve, this.coalesceMs));
            current = state.pending;
            state.pending = undefined;
        }
    }

    private getQueueKey(event: SocialEvent): string {
        if (event.type === "message.received") {
            return [
                event.platform,
                event.accountId,
                event.channel,
                event.channelId || event.contact.id
            ].join(":");
        }

        return [event.platform, event.accountId, event.id].join(":");
    }

    private mergeEvents(previous: SocialEvent, next: SocialEvent): SocialEvent {
        if (previous.type !== "message.received" || next.type !== "message.received") return next;
        return this.mergeMessageEvents(previous, next);
    }

    private mergeMessageEvents(previous: SocialMessageEvent, next: SocialMessageEvent): SocialMessageEvent {
        const segments = [...previous.segments, ...next.segments];
        return {
            ...next,
            segments,
            text: segments.map(segment => `${segment.contact.name}: ${segment.text}`).join("\n")
        };
    }
}

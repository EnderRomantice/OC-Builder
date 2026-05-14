import type { SocialEvent } from "../core/types.js";

type Task = () => Promise<void>;

export class ConversationScheduler {
    private readonly queues = new Map<string, Promise<void>>();

    schedule(event: SocialEvent, task: Task): Promise<void> {
        const key = this.getQueueKey(event);
        const previous = this.queues.get(key) || Promise.resolve();
        const next = previous.catch(() => undefined).then(task);

        this.queues.set(key, next.finally(() => {
            if (this.queues.get(key) === next) {
                this.queues.delete(key);
            }
        }));

        return next;
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
}

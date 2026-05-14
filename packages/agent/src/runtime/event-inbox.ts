import type { EventInboxRecord, SocialEvent } from "../core/types.js";

export class EventInbox {
    private readonly records = new Map<string, EventInboxRecord>();

    enqueue(event: SocialEvent): EventInboxRecord {
        const existing = this.records.get(event.id);
        if (existing) return existing;

        const record: EventInboxRecord = { event, status: "pending" };
        this.records.set(event.id, record);
        return record;
    }

    markProcessing(eventId: string) {
        this.update(eventId, { status: "processing", error: undefined });
    }

    markDone(eventId: string) {
        this.update(eventId, { status: "done", error: undefined });
    }

    markFailed(eventId: string, error: unknown) {
        this.update(eventId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    }

    private update(eventId: string, patch: Partial<EventInboxRecord>) {
        const record = this.records.get(eventId);
        if (!record) return;
        this.records.set(eventId, { ...record, ...patch });
    }
}

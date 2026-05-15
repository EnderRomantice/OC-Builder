import type { SendMessageAction, SocialAction, SocialRuntimeActions } from "../core/types.js";

export class ActionDispatcher {
    private readonly executed = new Set<string>();

    constructor(private readonly actions: SocialRuntimeActions) {}

    async dispatch(action: SocialAction): Promise<void> {
        if (action.type === "memory.propose") return;
        if (action.type === "message.send") {
            await this.dispatchMessage(action);
        }
    }

    private async dispatchMessage(action: SendMessageAction) {
        const key = [
            action.sourceEventId,
            action.type,
            action.target.platform,
            action.target.accountId,
            action.target.channel,
            action.target.roomId || action.target.contactId || "",
            action.text
        ].join(":");

        if (this.executed.has(key)) return;
        await this.actions.sendMessage(action);
        this.executed.add(key);
    }
}

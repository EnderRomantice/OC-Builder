export type PlatformId = "wechat" | "qq";

export type SocialChannel = "private" | "group";

export interface CharacterConfig {
    id: string;
    name: string;
    displayName: string;
    soulPath: string;
    modelId: string;
}

export interface SocialContact {
    id: string;
    name: string;
    alias?: string;
    handle?: string;
    memoryId: string;
}

export interface SocialMessageSegment {
    contact: SocialContact;
    text: string;
    timestamp: string;
}

export interface SocialEventBase {
    id: string;
    platform: PlatformId;
    accountId: string;
    receivedAt: string;
    raw: unknown;
}

export interface SocialMessageEvent extends SocialEventBase {
    type: "message.received";
    channel: SocialChannel;
    channelId?: string;
    accountName?: string;
    contact: SocialContact;
    text: string;
    segments: SocialMessageSegment[];
}

export type SocialEvent = SocialMessageEvent;

export interface ContactSearchResult {
    id: string;
    name: string;
    alias?: string;
}

export interface ActionTarget {
    platform: PlatformId;
    accountId: string;
    channel: SocialChannel;
    contactId?: string;
    roomId?: string;
    mentionContactIds?: string[];
}

export interface SendMessageAction {
    type: "message.send";
    target: ActionTarget;
    text: string;
    sourceEventId: string;
}

export interface MemoryProposalAction {
    type: "memory.propose";
    subject: MemorySubject;
    memoryType: "fact" | "preference" | "relationship" | "boundary" | "event";
    content: string;
    sourceEventIds: string[];
    confidence: number;
}

export type SocialAction = SendMessageAction | MemoryProposalAction;

export interface MemorySubject {
    characterId: string;
    platform: PlatformId;
    accountId: string;
    contactId: string;
}

export interface ContextPack {
    event: SocialMessageEvent;
    soul: string;
    userProfile: string;
    recentHistory: string;
    pendingTasks: string;
    serviceContactId?: string;
    roomHistory: any[];
    relationshipHistory: any[];
}

export interface EventInboxRecord {
    event: SocialEvent;
    status: "pending" | "processing" | "done" | "failed";
    error?: string;
}

export interface SocialRuntimeActions {
    searchContacts(query: string): Promise<ContactSearchResult[]>;
    sendPrivateMessage(contactId: string, text: string): Promise<{ success: boolean; label?: string }>;
    sendMessage(action: SendMessageAction): Promise<void>;
}

import type { SocialMessageEvent } from "../core/types.js";
import { serviceMemoryClient, type ServiceMemoryRecord } from "./service-memory-client.js";

export interface RetrievedMemoryContext {
    text: string;
    records: ServiceMemoryRecord[];
}

const MEMORY_TYPES = [
    "fact",
    "preference",
    "boundary",
    "relationship_state_delta",
    "emotional_milestone",
    "promise",
    "profile"
];

const STOPWORDS = new Set([
    "你",
    "我",
    "他",
    "她",
    "它",
    "我们",
    "你们",
    "他们",
    "这个",
    "那个",
    "什么",
    "怎么",
    "为什么",
    "是不是",
    "记得",
    "刚才",
    "之前",
    "现在",
    "一下",
    "the",
    "and",
    "that",
    "this",
    "what",
    "why",
    "how"
]);

export class MemoryRetriever {
    async retrieve(contactId: string, event: SocialMessageEvent): Promise<RetrievedMemoryContext> {
        const queryTerms = this.extractQueryTerms(event.text);
        const inferredTypes = this.inferTypes(event.text);
        const resultMap = new Map<string, ServiceMemoryRecord>();

        const important = await serviceMemoryClient.searchMemories({ contactId, limit: 12 });
        for (const memory of important) resultMap.set(memory.id, memory);

        for (const query of queryTerms.slice(0, 4)) {
            const matches = await serviceMemoryClient.searchMemories({ contactId, q: query, limit: 8 });
            for (const memory of matches) resultMap.set(memory.id, memory);
        }

        for (const type of inferredTypes) {
            const matches = await serviceMemoryClient.searchMemories({ contactId, type, limit: 6 });
            for (const memory of matches) resultMap.set(memory.id, memory);
        }

        const records = [...resultMap.values()]
            .sort((a, b) => {
                const scoreDelta = this.score(b, queryTerms) - this.score(a, queryTerms);
                if (scoreDelta !== 0) return scoreDelta;
                return Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || "");
            })
            .slice(0, 20);

        console.log(`[MEMORY] Retrieved ${records.length} memories for contactId=${contactId}; queries=${JSON.stringify(queryTerms)}; types=${JSON.stringify(inferredTypes)}`);

        return {
            records,
            text: this.format(records)
        };
    }

    private inferTypes(text: string): string[] {
        const types = new Set<string>();

        if (/喜欢|讨厌|最爱|偏爱|歌|曲|专辑|音乐|风格|口味/.test(text)) {
            types.add("preference");
            types.add("emotional_milestone");
        }
        if (/记得|忘记|之前|上次|刚才|聊过|发过|说过/.test(text)) {
            types.add("emotional_milestone");
            types.add("relationship_state_delta");
            types.add("preference");
            types.add("fact");
        }
        if (/别|不要|不许|雷区|边界|讨厌/.test(text)) {
            types.add("boundary");
        }
        if (/答应|承诺|待会|提醒|记得要|帮我/.test(text)) {
            types.add("promise");
        }

        return [...types].filter(type => MEMORY_TYPES.includes(type));
    }

    private extractQueryTerms(text: string): string[] {
        const normalized = text
            .replace(/[，。！？、；：“”"'（）()【】\[\]{}<>《》]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        const terms = new Set<string>();
        for (const match of normalized.matchAll(/[\p{Script=Han}A-Za-z0-9_.-]{2,}/gu)) {
            const term = match[0].trim();
            if (!STOPWORDS.has(term.toLowerCase())) terms.add(term);
        }

        for (const match of text.matchAll(/[《“"]([^《》“”"]{2,24})[》”"]/g)) {
            terms.add(match[1].trim());
        }

        return [...terms].sort((a, b) => b.length - a.length).slice(0, 8);
    }

    private score(memory: ServiceMemoryRecord, queryTerms: string[]): number {
        const haystack = [
            memory.type,
            memory.summary,
            memory.content || "",
            JSON.stringify(memory.topicsJson || ""),
            JSON.stringify(memory.emotionsJson || "")
        ].join("\n").toLowerCase();

        const relevance = queryTerms.reduce((sum, term) => {
            return haystack.includes(term.toLowerCase()) ? sum + 1 : sum;
        }, 0);

        return relevance * 2 + memory.importance + memory.confidence * 0.5;
    }

    private format(records: ServiceMemoryRecord[]): string {
        if (records.length === 0) return "No service memories for this contact.";

        return records.map(memory => {
            const content = memory.content?.trim();
            const base = `- ${memory.type}: ${memory.summary}`;
            return content ? `${base}\n  ${content}` : base;
        }).join("\n");
    }
}

export const memoryRetriever = new MemoryRetriever();

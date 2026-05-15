import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { RecordEventDto } from "./events.controller";
import { parseJsonArray, toJson } from "./json";
import type { CreateMemoryDto, CurateMemoryDto, MemoryDraftDto, MemoryPatchDto } from "./memories.controller";
import type { CreateProactiveTaskDto, UpdateProactiveTaskDto } from "./proactive-tasks.controller";
import type { CreatePromiseDto, UpdatePromiseDto } from "./promises.controller";

@Injectable()
export class MemoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async recordEvent(input: RecordEventDto) {
    const account = await this.prisma.platformAccount.upsert({
      where: {
        platform_accountId: {
          platform: input.platform,
          accountId: input.accountId
        }
      },
      create: {
        platform: input.platform,
        accountId: input.accountId
      },
      update: {}
    });

    const contact = input.contactExternalId
      ? await this.prisma.contact.upsert({
          where: {
            platformAccountId_externalId: {
              platformAccountId: account.id,
              externalId: input.contactExternalId
            }
          },
          create: {
            platformAccountId: account.id,
            externalId: input.contactExternalId,
            memoryId: input.contactMemoryId || [input.platform, input.accountId, input.contactExternalId].join("__"),
            name: input.contactName || input.contactExternalId
          },
          update: {
            memoryId: input.contactMemoryId,
            name: input.contactName
          }
        })
      : null;

    const conversation = input.channel && input.conversationExternalId
      ? await this.prisma.conversation.upsert({
          where: {
            platformAccountId_channel_externalId: {
              platformAccountId: account.id,
              channel: input.channel,
              externalId: input.conversationExternalId
            }
          },
          create: {
            platformAccountId: account.id,
            channel: input.channel,
            externalId: input.conversationExternalId,
            title: input.conversationTitle
          },
          update: {
            title: input.conversationTitle
          }
        })
      : null;

    return this.prisma.event.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        platformAccountId: account.id,
        contactId: contact?.id,
        conversationId: conversation?.id,
        type: input.type,
        channel: input.channel,
        text: input.text,
        rawJson: toJson(input.raw, {}),
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date()
      },
      update: {
        text: input.text,
        rawJson: toJson(input.raw, {})
      }
    });
  }

  listEvents(input: { contactId?: string; limit?: number }) {
    return this.prisma.event.findMany({
      where: input.contactId ? { contactId: input.contactId } : undefined,
      orderBy: { occurredAt: "desc" },
      take: Math.min(input.limit || 50, 200)
    });
  }

  createMemory(input: CreateMemoryDto) {
    return this.prisma.memory.create({
      data: {
        characterId: input.characterId,
        contactId: input.contactId,
        type: input.type,
        summary: input.summary,
        content: input.content,
        topicsJson: toJson(input.topics, []),
        emotionsJson: toJson(input.emotions, []),
        metadataJson: toJson(input.metadata, {}),
        importance: input.importance ?? 0.5,
        confidence: input.confidence ?? 0.7,
        events: input.sourceEventIds?.length
          ? {
              create: input.sourceEventIds.map((eventId) => ({
                event: { connect: { id: eventId } }
              }))
            }
          : undefined
      }
    });
  }

  async curateMemory(input: CurateMemoryDto) {
    if (input.action === "ignore") {
      return {
        action: "ignore",
        reason: input.reason || "Ignored by memory review."
      };
    }

    if (input.action === "create") {
      if (!input.memory) throw new Error("create requires memory");
      const memory = await this.createCuratedMemory(input.memory, input.reason);
      return { action: "create", memory };
    }

    if (input.action === "merge") {
      if (!input.targetMemoryId || !input.patch) throw new Error("merge requires targetMemoryId and patch");
      const memory = await this.mergeMemory(input.targetMemoryId, input.patch, input.reason);
      return { action: "merge", memory };
    }

    if (input.action === "supersede") {
      if (!input.oldMemoryId || !input.memory) throw new Error("supersede requires oldMemoryId and memory");
      const memory = await this.supersedeMemory(input.oldMemoryId, input.memory, input.reason);
      return { action: "supersede", memory };
    }

    throw new Error(`Unsupported memory curation action: ${input.action}`);
  }

  private async createCuratedMemory(input: MemoryDraftDto, reviewReason?: string) {
    return this.prisma.memory.create({
      data: {
        characterId: input.characterId,
        contactId: input.contactId,
        type: input.type,
        summary: input.summary,
        content: input.content,
        topicsJson: toJson(input.topics, []),
        emotionsJson: toJson(input.emotions, []),
        metadataJson: this.withReviewReason(input.metadata, reviewReason),
        importance: input.importance ?? 0.5,
        confidence: input.confidence ?? 0.7,
        events: this.eventLinks(input.sourceEventIds)
      }
    });
  }

  private async mergeMemory(targetMemoryId: string, patch: MemoryPatchDto, reviewReason?: string) {
    const existing = await this.prisma.memory.findUniqueOrThrow({
      where: { id: targetMemoryId }
    });
    const nextMetadata = {
      ...this.parseJsonObject(existing.metadataJson),
      ...this.parseMetadata(patch.metadata),
      ...(reviewReason ? { lastReviewReason: reviewReason } : {})
    };

    return this.prisma.$transaction(async (tx: any) => {
      const memory = await tx.memory.update({
        where: { id: targetMemoryId },
        data: {
          summary: patch.summary,
          content: patch.content,
          topicsJson: patch.topics ? toJson(this.mergeStrings(parseJsonArray(existing.topicsJson), patch.topics), []) : undefined,
          emotionsJson: patch.emotions ? toJson(this.mergeStrings(parseJsonArray(existing.emotionsJson), patch.emotions), []) : undefined,
          metadataJson: toJson(nextMetadata, {}),
          importance: patch.importance,
          confidence: patch.confidence
        }
      });

      await this.linkSourceEvents(tx, targetMemoryId, patch.sourceEventIds);
      return memory;
    });
  }

  private async supersedeMemory(oldMemoryId: string, input: MemoryDraftDto, reviewReason?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.memory.update({
        where: { id: oldMemoryId },
        data: { status: "superseded" }
      });

      const memory = await tx.memory.create({
        data: {
          characterId: input.characterId,
          contactId: input.contactId,
          type: input.type,
          summary: input.summary,
          content: input.content,
          topicsJson: toJson(input.topics, []),
          emotionsJson: toJson(input.emotions, []),
          metadataJson: this.withReviewReason(input.metadata, reviewReason),
          importance: input.importance ?? 0.5,
          confidence: input.confidence ?? 0.7,
          events: this.eventLinks(input.sourceEventIds)
        }
      });

      await tx.memoryLink.create({
        data: {
          fromMemoryId: memory.id,
          toMemoryId: oldMemoryId,
          relation: "supersedes"
        }
      });

      return memory;
    });
  }

  async searchMemories(input: {
    contactId?: string;
    type?: string;
    status?: string;
    q?: string;
    topic?: string;
    limit?: number;
  }) {
    const q = input.q?.trim();
    const candidates = await this.prisma.memory.findMany({
      where: {
        contactId: input.contactId,
        type: input.type,
        status: input.status || "active",
        ...(q ? { OR: [{ summary: { contains: q } }, { content: { contains: q } }] } : {})
      },
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
      take: Math.min(input.limit || 20, 100)
    });

    return input.topic
      ? candidates.filter((memory) => parseJsonArray(memory.topicsJson).includes(input.topic))
      : candidates;
  }

  markMemoryAccessed(id: string) {
    return this.prisma.memory.update({
      where: { id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date()
      }
    });
  }

  createPromise(input: CreatePromiseDto) {
    return this.prisma.promise.create({
      data: {
        contactId: input.contactId,
        description: input.description,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined
      }
    });
  }

  listPromises(input: { contactId?: string; status?: string }) {
    return this.prisma.promise.findMany({
      where: {
        contactId: input.contactId,
        status: input.status
      },
      orderBy: { createdAt: "desc" }
    });
  }

  updatePromise(id: string, input: UpdatePromiseDto) {
    return this.prisma.promise.update({
      where: { id },
      data: {
        status: input.status,
        dueAt: input.dueAt === null ? null : input.dueAt ? new Date(input.dueAt) : undefined,
        fulfilledAt: input.status === "done" ? new Date() : undefined
      }
    });
  }

  createProactiveTask(input: CreateProactiveTaskDto) {
    return this.prisma.proactiveTask.create({
      data: {
        characterId: input.characterId,
        contactId: input.contactId,
        type: input.type,
        reason: input.reason,
        promptContext: input.promptContext,
        scheduledAt: new Date(input.scheduledAt),
        sourceMemoryIdsJson: toJson(input.sourceMemoryIds, []),
        sourcePromiseIdsJson: toJson(input.sourcePromiseIds, [])
      }
    });
  }

  listProactiveTasks(input: {
    contactId?: string;
    status?: string;
    dueBefore?: string;
    limit?: number;
  }) {
    return this.prisma.proactiveTask.findMany({
      where: {
        contactId: input.contactId,
        status: input.status,
        scheduledAt: input.dueBefore ? { lte: new Date(input.dueBefore) } : undefined
      },
      orderBy: { scheduledAt: "asc" },
      take: Math.min(input.limit || 50, 200)
    });
  }

  updateProactiveTask(id: string, input: UpdateProactiveTaskDto) {
    return this.prisma.proactiveTask.update({
      where: { id },
      data: {
        status: input.status,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        lastError: input.lastError === null ? null : input.lastError,
        attempts: input.incrementAttempts ? { increment: 1 } : undefined
      }
    });
  }

  private eventLinks(sourceEventIds?: string[]) {
    const uniqueIds = [...new Set(sourceEventIds || [])].filter(Boolean);
    return uniqueIds.length
      ? {
          create: uniqueIds.map((eventId) => ({
            event: { connect: { id: eventId } }
          }))
        }
      : undefined;
  }

  private async linkSourceEvents(
    tx: any,
    memoryId: string,
    sourceEventIds?: string[]
  ) {
    const uniqueIds = [...new Set(sourceEventIds || [])].filter(Boolean);
    if (uniqueIds.length === 0) return;

    for (const eventId of uniqueIds) {
      await tx.memoryEvent.upsert({
        where: {
          memoryId_eventId_role: {
            memoryId,
            eventId,
            role: "evidence"
          }
        },
        create: {
          memoryId,
          eventId,
          role: "evidence"
        },
        update: {}
      });
    }
  }

  private withReviewReason(metadata: unknown, reviewReason?: string) {
    return toJson({
      ...this.parseMetadata(metadata),
      ...(reviewReason ? { reviewReason } : {})
    }, {});
  }

  private parseMetadata(metadata: unknown): Record<string, unknown> {
    return metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {};
  }

  private parseJsonObject(value: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  private mergeStrings(existing: unknown[], incoming: string[]): string[] {
    const values = new Set<string>();
    for (const item of existing) {
      if (typeof item === "string" && item.trim()) values.add(item.trim());
    }
    for (const item of incoming) {
      if (typeof item === "string" && item.trim()) values.add(item.trim());
    }
    return [...values];
  }
}

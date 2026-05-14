import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RecordEventDto } from "./events.controller";
import { parseJsonArray, toJson } from "./json";
import { CreateMemoryDto } from "./memories.controller";
import { CreatePromiseDto, UpdatePromiseDto } from "./promises.controller";

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
}

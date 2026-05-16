import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertCharacterDto, UpsertContactDto, UpsertPlatformAccountDto } from "./identity.controller";

@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  upsertCharacter(input: UpsertCharacterDto) {
    return this.prisma.character.upsert({
      where: { id: input.id },
      create: input,
      update: {
        name: input.name,
        displayName: input.displayName,
        soulPath: input.soulPath,
        modelId: input.modelId
      }
    });
  }

  upsertPlatformAccount(input: UpsertPlatformAccountDto) {
    return this.prisma.platformAccount.upsert({
      where: {
        platform_accountId: {
          platform: input.platform,
          accountId: input.accountId
        }
      },
      create: input,
      update: { label: input.label }
    });
  }

  async upsertContact(input: UpsertContactDto) {
    const account = await this.upsertPlatformAccount({
      platform: input.platform,
      accountId: input.accountId
    });

    return this.prisma.contact.upsert({
      where: {
        platformAccountId_externalId: {
          platformAccountId: account.id,
          externalId: input.externalId
        }
      },
      create: {
        platformAccountId: account.id,
        externalId: input.externalId,
        memoryId: input.memoryId,
        name: input.name,
        alias: input.alias,
        handle: input.handle
      },
      update: {
        memoryId: input.memoryId,
        name: input.name,
        alias: input.alias,
        handle: input.handle
      }
    });
  }

  getContact(id: string) {
    return this.prisma.contact.findUniqueOrThrow({
      where: { id },
      include: { platformAccount: true }
    });
  }

  async listContacts(input: { platform?: string; accountId?: string; limit?: number }) {
    const account = input.platform && input.accountId
      ? await this.prisma.platformAccount.findUnique({
          where: {
            platform_accountId: {
              platform: input.platform,
              accountId: input.accountId
            }
          }
        })
      : null;

    if (input.platform && input.accountId && !account) return [];

    return this.prisma.contact.findMany({
      where: account ? { platformAccountId: account.id } : undefined,
      include: {
        platformAccount: true,
        events: {
          orderBy: { occurredAt: "desc" },
          take: 6
        }
      },
      orderBy: { updatedAt: "desc" },
      take: Math.min(input.limit || 100, 300)
    });
  }
}

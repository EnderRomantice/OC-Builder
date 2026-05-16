import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { IdentityService } from "./identity.service";

export class UpsertCharacterDto {
  id: string;
  name: string;
  displayName: string;
  soulPath?: string;
  modelId?: string;
}

export class UpsertPlatformAccountDto {
  platform: string;
  accountId: string;
  label?: string;
}

export class UpsertContactDto {
  platform: string;
  accountId: string;
  externalId: string;
  memoryId: string;
  name: string;
  alias?: string;
  handle?: string;
}

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post("characters")
  upsertCharacter(@Body() body: UpsertCharacterDto) {
    return this.identity.upsertCharacter(body);
  }

  @Post("platform-accounts")
  upsertPlatformAccount(@Body() body: UpsertPlatformAccountDto) {
    return this.identity.upsertPlatformAccount(body);
  }

  @Post("contacts")
  upsertContact(@Body() body: UpsertContactDto) {
    return this.identity.upsertContact(body);
  }

  @Get("contacts/:id")
  getContact(@Param("id") id: string) {
    return this.identity.getContact(id);
  }

  @Get("contacts")
  listContacts(
    @Query("platform") platform?: string,
    @Query("accountId") accountId?: string,
    @Query("limit") limit?: string
  ) {
    return this.identity.listContacts({
      platform,
      accountId,
      limit: limit ? Number(limit) : undefined
    });
  }
}

import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { MemoriesService } from "./memories.service";

export class RecordEventDto {
  id: string;
  platform: string;
  accountId: string;
  type: string;
  channel?: string;
  conversationExternalId?: string;
  conversationTitle?: string;
  contactExternalId?: string;
  contactMemoryId?: string;
  contactName?: string;
  text?: string;
  raw?: unknown;
  occurredAt?: string;
}

@Controller("events")
export class EventsController {
  constructor(private readonly memories: MemoriesService) {}

  @Post()
  recordEvent(@Body() body: RecordEventDto) {
    return this.memories.recordEvent(body);
  }

  @Get()
  listEvents(@Query("contactId") contactId?: string, @Query("limit") limit?: string) {
    return this.memories.listEvents({ contactId, limit: limit ? Number(limit) : undefined });
  }
}

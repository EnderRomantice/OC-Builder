import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { MemoriesService } from "./memories.service";

export class CreateMemoryDto {
  characterId?: string;
  contactId?: string;
  type: string;
  summary: string;
  content?: string;
  topics?: string[];
  emotions?: string[];
  metadata?: unknown;
  importance?: number;
  confidence?: number;
  sourceEventIds?: string[];
}

export class MemoryDraftDto {
  characterId?: string;
  contactId: string;
  type: string;
  summary: string;
  content?: string;
  topics?: string[];
  emotions?: string[];
  metadata?: unknown;
  importance?: number;
  confidence?: number;
  sourceEventIds?: string[];
}

export class MemoryPatchDto {
  summary?: string;
  content?: string;
  topics?: string[];
  emotions?: string[];
  metadata?: unknown;
  importance?: number;
  confidence?: number;
  sourceEventIds?: string[];
}

export class CurateMemoryDto {
  action: "create" | "merge" | "supersede" | "ignore";
  reason?: string;
  targetMemoryId?: string;
  oldMemoryId?: string;
  memory?: MemoryDraftDto;
  patch?: MemoryPatchDto;
}

@Controller("memories")
export class MemoriesController {
  constructor(private readonly memories: MemoriesService) {}

  @Post()
  createMemory(@Body() body: CreateMemoryDto) {
    return this.memories.createMemory(body);
  }

  @Post("curate")
  curateMemory(@Body() body: CurateMemoryDto) {
    return this.memories.curateMemory(body);
  }

  @Get()
  searchMemories(
    @Query("contactId") contactId?: string,
    @Query("type") type?: string,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("topic") topic?: string,
    @Query("limit") limit?: string
  ) {
    return this.memories.searchMemories({
      contactId,
      type,
      status,
      q,
      topic,
      limit: limit ? Number(limit) : undefined
    });
  }

  @Post(":id/access")
  markAccessed(@Param("id") id: string) {
    return this.memories.markMemoryAccessed(id);
  }
}

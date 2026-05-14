import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { MemoriesService } from "./memories.service";

export class CreatePromiseDto {
  contactId: string;
  description: string;
  dueAt?: string;
}

export class UpdatePromiseDto {
  status?: string;
  dueAt?: string | null;
}

@Controller("promises")
export class PromisesController {
  constructor(private readonly memories: MemoriesService) {}

  @Post()
  createPromise(@Body() body: CreatePromiseDto) {
    return this.memories.createPromise(body);
  }

  @Get()
  listPromises(@Query("contactId") contactId?: string, @Query("status") status?: string) {
    return this.memories.listPromises({ contactId, status });
  }

  @Patch(":id")
  updatePromise(@Param("id") id: string, @Body() body: UpdatePromiseDto) {
    return this.memories.updatePromise(id, body);
  }
}

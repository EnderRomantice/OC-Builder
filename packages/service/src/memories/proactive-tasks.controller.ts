import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { MemoriesService } from "./memories.service";

export class CreateProactiveTaskDto {
  characterId?: string;
  contactId: string;
  type: string;
  reason: string;
  promptContext?: string;
  scheduledAt: string;
  sourceMemoryIds?: string[];
  sourcePromiseIds?: string[];
}

export class UpdateProactiveTaskDto {
  status?: string;
  scheduledAt?: string;
  lastError?: string | null;
  incrementAttempts?: boolean;
}

@Controller("proactive-tasks")
export class ProactiveTasksController {
  constructor(private readonly memories: MemoriesService) {}

  @Post()
  createTask(@Body() body: CreateProactiveTaskDto) {
    return this.memories.createProactiveTask(body);
  }

  @Get()
  listTasks(
    @Query("contactId") contactId?: string,
    @Query("status") status?: string,
    @Query("dueBefore") dueBefore?: string,
    @Query("limit") limit?: string
  ) {
    return this.memories.listProactiveTasks({
      contactId,
      status,
      dueBefore,
      limit: limit ? Number(limit) : undefined
    });
  }

  @Patch(":id")
  updateTask(@Param("id") id: string, @Body() body: UpdateProactiveTaskDto) {
    return this.memories.updateProactiveTask(id, body);
  }
}

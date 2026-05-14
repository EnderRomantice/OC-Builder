import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { MemoriesController } from "./memories.controller";
import { MemoriesService } from "./memories.service";
import { PromisesController } from "./promises.controller";

@Module({
  controllers: [EventsController, MemoriesController, PromisesController],
  providers: [MemoriesService]
})
export class MemoriesModule {}

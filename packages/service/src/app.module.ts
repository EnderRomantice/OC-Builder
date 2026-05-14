import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { IdentityModule } from "./identity/identity.module";
import { MemoriesModule } from "./memories/memories.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, HealthModule, IdentityModule, MemoriesModule]
})
export class AppModule {}

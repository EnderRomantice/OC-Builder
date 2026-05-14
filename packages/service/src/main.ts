import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  await app.listen(Number(process.env.PORT || 3001), process.env.HOST || "127.0.0.1");
}

bootstrap();

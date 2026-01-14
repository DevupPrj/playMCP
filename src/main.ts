import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // 로그가 stdout(표준출력)으로 나가면 MCP 통신이 깨짐.
    // 로그를 끄거나, stderr(에러출력)로만 내보내야 함.
    // logger: ['error', 'warn'],
    logger: false, // 로거 끄기
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, {
      // 임시로 에러 로그 활성화 (디버깅용)
      logger: ['error', 'warn', 'log'],
    });
    await app.listen(process.env.PORT ?? 3000);
    console.error(
      `✅ Application is running on: http://localhost:${process.env.PORT ?? 3000}`,
    );
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}
bootstrap();

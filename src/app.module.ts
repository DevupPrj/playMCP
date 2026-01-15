import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config'; // 환경변수 관리
import { TypeOrmModule } from '@nestjs/typeorm'; // ORM 관리
import { ScheduleModule } from '@nestjs/schedule'; // 크론 작업
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { McpModule } from './mcp/mcp.module';
import { PerformanceModule } from './api/performance/performance.module';
import { RagModule } from './lib/rag/rag.module';

@Module({
  imports: [
    ScheduleModule.forRoot(), // 크론 작업 활성화
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('DB_HOST');
        const portStr = configService.get<string>('DB_PORT') || '5432';
        const port = parseInt(portStr, 10) || 5432;
        const username = configService.get<string>('DB_USERNAME');
        const password = configService.get<string>('DB_PASSWORD');
        const database = configService.get<string>('DB_DATABASE');

        // DB 연결 정보 확인 (비밀번호는 출력하지 않음)
        console.error('📊 DB Config:', {
          host,
          port,
          username,
          password: password ? `***${password.length}자***` : '❌ 없음',
          database,
        });

        const dbConfig = {
          type: 'postgres' as const,
          host,
          port,
          username,
          password,
          database,
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: true,
          logging: true,
        };

        return dbConfig;
      },
    }),

    McpModule,
    PerformanceModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

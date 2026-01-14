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
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true,
        logging: true,
      }),
    }),

    McpModule,
    PerformanceModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

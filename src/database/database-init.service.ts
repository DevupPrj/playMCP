import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseInitService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseInitService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    try {
      // pgvector extension 활성화
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.logger.log('✅ pgvector extension 활성화 완료');

      // embedding 컬럼이 text 타입이면 vector 타입으로 변경 시도
      // (이미 vector 타입이면 에러가 나지만 무시)
      try {
        await this.dataSource.query(`
          DO $$ 
          BEGIN
            IF EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = 'performances' 
              AND column_name = 'embedding' 
              AND data_type = 'text'
            ) THEN
              ALTER TABLE performances 
              ALTER COLUMN embedding TYPE vector(1536) 
              USING embedding::vector;
            END IF;
          END $$;
        `);
        this.logger.log('✅ embedding 컬럼을 vector 타입으로 변경 완료');
      } catch (error) {
        // 이미 vector 타입이거나 다른 이유로 실패해도 계속 진행
        this.logger.warn(
          '⚠️ embedding 컬럼 타입 변경 스킵 (이미 vector 타입이거나 다른 이유)',
        );
      }
    } catch (error) {
      this.logger.error('❌ Database 초기화 실패:', error);
      // extension 활성화 실패해도 앱은 계속 실행
    }
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagService } from './rag.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { Performance } from '../../api/performance/entities/performance.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Performance])],
  providers: [RagService, EmbeddingService, VectorStoreService],
  exports: [
    RagService, // 통합 서비스 (임베딩 + 검색)
    EmbeddingService, // 임베딩 생성만 (독립 사용 가능)
    VectorStoreService, // 벡터 검색만 (독립 사용 가능)
  ],
})
export class RagModule {}

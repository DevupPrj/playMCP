import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagService } from './rag.service';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { Performance } from '../../api/performance/entities/performance.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Performance])],
  providers: [RagService, EmbeddingService, VectorStoreService],
  exports: [RagService], // 다른 모듈에서 사용 가능하도록 export
})
export class RagModule {}

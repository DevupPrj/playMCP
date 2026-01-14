import { Injectable } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { Performance } from '../../api/performance/entities/performance.entity';
import { VectorSearchFilters, VectorSearchResult } from './types/rag.types';

export type PerformanceSearchResult = Performance & { similarity: number };

@Injectable()
export class RagService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  /**
   * 자연어 쿼리를 벡터 검색으로 변환하여 결과 반환
   * MCP 요청에서 사용하는 메인 메서드
   */
  async searchVector(
    query: string,
    filters: VectorSearchFilters = {},
    limit: number = 10,
  ): Promise<PerformanceSearchResult[]> {
    // 1. 자연어 쿼리를 벡터로 변환
    const embedding = await this.embeddingService.embed(query);

    // 2. PostgreSQL 벡터 DB에서 유사도 검색
    const results = await this.vectorStoreService.searchSimilar(
      embedding,
      filters,
      limit,
    );

    return results;
  }
}

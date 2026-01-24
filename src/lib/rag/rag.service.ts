import { Injectable } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { VectorStoreService } from './vector-store.service';
import { Performance } from '../../api/performance/entities/performance.entity';
import { VectorSearchFilters } from './types/rag.types';

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
   *
   * 책임: 임베딩 생성과 벡터 검색을 조합 (오케스트레이션)
   */
  async searchVector(
    query: string,
    filters: VectorSearchFilters = {},
    limit: number = 10,
  ): Promise<PerformanceSearchResult[]> {
    // 1. 자연어 쿼리를 벡터로 변환 (EmbeddingService 책임)
    const embedding = await this.embeddingService.embed(query);

    // 2. 벡터로 유사도 검색 (VectorStoreService 책임)
    const results = await this.vectorStoreService.searchSimilar(
      embedding,
      filters,
      limit,
    );

    return results;
  }

  /**
   * 벡터 검색만 수행 (이미 임베딩이 있는 경우)
   * 임베딩 생성과 검색을 분리하여 사용 가능
   */
  async searchByEmbedding(
    embedding: number[],
    filters: VectorSearchFilters = {},
    limit: number = 10,
  ): Promise<PerformanceSearchResult[]> {
    return this.vectorStoreService.searchSimilar(embedding, filters, limit);
  }

  /**
   * 자연어 쿼리를 임베딩으로만 변환 (검색 없이)
   * 임베딩 생성과 검색을 분리하여 사용 가능
   */
  async embedQuery(query: string): Promise<number[]> {
    return this.embeddingService.embed(query);
  }
}

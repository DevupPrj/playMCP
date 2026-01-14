import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Performance } from '../../api/performance/entities/performance.entity';

@Injectable()
export class VectorStoreService {
  constructor(
    @InjectRepository(Performance)
    private performanceRepository: Repository<Performance>,
  ) {}

  /**
   * PostgreSQL 벡터 DB에서 유사도 검색
   * @param embedding 벡터 임베딩
   * @param filters 필터 조건
   * @param limit 결과 개수
   * @returns 검색 결과 (유사도 포함)
   */
  async searchSimilar(
    embedding: number[],
    filters: {
      status?: string;
      place?: string;
      genre?: string;
      date?: string;
    },
    limit: number = 10,
  ): Promise<(Performance & { similarity: number })[]> {
    const vectorString = `[${embedding.join(',')}]`;

    // WHERE 절 구성
    const conditions: string[] = [];
    if (filters.status) {
      conditions.push(`status = '${filters.status}'`);
    }
    if (filters.place) {
      conditions.push(`place_name LIKE '%${filters.place}%'`);
    }
    if (filters.genre) {
      conditions.push(`genre LIKE '%${filters.genre}%'`);
    }
    if (filters.date) {
      conditions.push(`'${filters.date}' BETWEEN start_date AND end_date`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // PostgreSQL 벡터 유사도 검색 쿼리 (pgvector 사용)
    const query = `
      SELECT 
        *,
        1 - (embedding <=> $1::vector) as similarity
      FROM performance
      ${whereClause}
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `;

    const results = await this.performanceRepository.query(query, [
      vectorString,
      limit,
    ]);

    return results;
  }
}

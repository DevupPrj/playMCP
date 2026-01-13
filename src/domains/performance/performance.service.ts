import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Performance } from './entities/performance.entity';

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(Performance)
    private performanceRepository: Repository<Performance>,
  ) {}

  async search(keyword: string, status: string = '공연중') {
    return this.performanceRepository
      .createQueryBuilder('p')
      .where('p.status = :status', { status })
      .andWhere('(p.title LIKE :keyword OR p.genre LIKE :keyword)', {
        keyword: `%${keyword}%`,
      })
      .limit(5)
      .getMany();
  }

  // 벡터 유사도 검색 (RAG용)
  // *실제 벡터 임베딩은 Python이나 외부 API에서 변환해서 들어온다고 가정
  // async recommendByVector(embedding: number[]) {
  //   // TypeORM에서는 벡터 연산자를 직접 지원하지 않으므로 raw query 사용
  //   const vectorString = `[${embedding.join(',')}]`;
  //
  //   return this.performanceRepository.query(
  //     `
  //     SELECT p.id, p.title, p.synopsis, p.genre,
  //            1 - (pv.embedding <=> $1) as similarity -- 코사인 유사도
  //     FROM performance_vectors pv
  //     JOIN performance p ON pv.performance_id = p.id
  //     ORDER BY pv.embedding <=> $1 ASC
  //     LIMIT 3;
  //     `,
  //     [vectorString],
  //   );
  // }
}

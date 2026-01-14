import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Performance } from './entities/performance.entity';
export type PerformanceSearchResult = Performance & { similarity: number };

@Injectable()
export class PerformanceService {
  constructor(
    @InjectRepository(Performance)
    private performanceRepository: Repository<Performance>,
  ) {}

  async searchUnified(params: {
    date?: string;
    day?: string;
    place?: string;
    genre?: string;
    status?: string;
    price?: string;
    useRag?: boolean;
    query?: string; // Rag용 자연어
    limit?: number;
  }): Promise<PerformanceSearchResult[]> {
    const {
      date,
      place,
      genre,
      status,
      price,
      day,
      query,
      useRag,
      limit = 6,
    } = params;

    // ---------------------------------------------------------
    // [RAG 사용] (벡터 유사도 정렬 + DB 필터)
    // ---------------------------------------------------------
    if (useRag && query) {
      // 임베딩 생성
      // const vector = await this.embeddings.embedQuery(query);
      // const vectorString = `[${vector.join(',')}]`;
      const vectorString = `[0,0,0,0,0,0,0,0,0,0]`;
      // const vector = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

      let whereClause = `status = '${status || '공연중'}'`;
      if (place) whereClause += ` AND place_name LIKE '%${place}%'`;
      if (genre) whereClause += ` AND genre LIKE '%${genre}%'`;
      if (date) whereClause += ` AND '${date}' BETWEEN start_date AND end_date`;

      // 가격 필터
      if (price) {
        if (price.includes('무료')) {
          whereClause += ` AND price LIKE '%무료%'`;
        } else {
          whereClause += ` AND price LIKE '%${price}%'`;
        }
      }

      // 요일 필터
      if (day) {
        const dayConditions = this.buildDayConditionRaw(day);
        if (dayConditions) {
          whereClause += ` AND (${dayConditions})`;
        }
      }

      // DB 조건이 높은 우선 순위
      return this.performanceRepository.query(
        `
        SELECT id, title, genre, place_name, start_date, end_date, 
               time_info, price, description, status,
               1 - (embedding <=> $1) as similarity
        FROM performances
        WHERE ${whereClause}
        AND embedding IS NOT NULL
        ORDER BY embedding <=> $1 ASC
        LIMIT $2
        `,
        [vectorString, limit],
      );
    }

    // ---------------------------------------------------------
    // [RAG 미사용] 순수 DB 검색
    // ---------------------------------------------------------
    else {
      const qb = this.performanceRepository
        .createQueryBuilder('p')
        .where('p.status = :status', { status: status || '공연중' })
        .orderBy('p.start_date', 'ASC')
        .limit(limit);

      if (place) {
        qb.andWhere('p.place_name LIKE :place', { place: `%${place}%` });
      }
      if (genre) {
        qb.andWhere('p.genre LIKE :genre', { genre: `%${genre}%` });
      }
      if (date) {
        qb.andWhere(':date BETWEEN p.start_date AND p.end_date', { date });
      }

      // 가격 필터
      if (price) {
        if (price.includes('무료')) {
          qb.andWhere('p.price LIKE :priceKeyword', {
            priceKeyword: '%무료%',
          });
        } else {
          qb.andWhere('p.price LIKE :priceKeyword', {
            priceKeyword: `%${price}%`,
          });
        }
      }

      // 요일 필터
      if (day) {
        if (day.includes('주말')) {
          qb.andWhere(
            '(p.time_info LIKE :sat OR p.time_info LIKE :sun OR p.time_info LIKE :weekend)',
            {
              sat: '%토%',
              sun: '%일%',
              weekend: '%주말%',
            },
          );
        } else if (day.includes('평일')) {
          qb.andWhere(
            new Brackets((subQb) => {
              subQb
                .where('p.time_info LIKE :mon', { mon: '%월%' })
                .orWhere('p.time_info LIKE :tue', { tue: '%화%' })
                .orWhere('p.time_info LIKE :wed', { wed: '%수%' })
                .orWhere('p.time_info LIKE :thu', { thu: '%목%' })
                .orWhere('p.time_info LIKE :fri', { fri: '%금%' })
                .orWhere('p.time_info LIKE :weekday', { weekday: '%평일%' });
            }),
          );
        } else {
          const dayChar = day.charAt(0); // '월'
          qb.andWhere('p.time_info LIKE :dayChar', { dayChar: `%${dayChar}%` });
        }
      }

      const results = await qb.getMany();
      return results as PerformanceSearchResult[];
    }
  }

  private buildDayConditionRaw(dayInput: string): string {
    if (dayInput.includes('주말')) {
      return "time_info LIKE '%토%' OR time_info LIKE '%일%' OR time_info LIKE '%주말%'";
    }
    if (dayInput.includes('평일')) {
      return "time_info LIKE '%월%' OR time_info LIKE '%화%' OR time_info LIKE '%수%' OR time_info LIKE '%목%' OR time_info LIKE '%금%' OR time_info LIKE '%평일%'";
    }
    const char = dayInput.replace('요일', '').trim().charAt(0);
    if (['월', '화', '수', '목', '금', '토', '일'].includes(char)) {
      return `time_info LIKE '%${char}%'`;
    }
    return '';
  }
}

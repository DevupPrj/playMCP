import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PerformanceService } from '../../domains/performance/performance.service';

@Injectable()
export class SearchTool {
  public readonly name = 'search_culture_events';

  public readonly schema = {
    date: z.string().optional().describe('특정 날짜 (YYYY-MM-DD)'),
    day_of_week: z.string().optional().describe('요일 (예: 월요일, 주말)'),
    region: z
      .string()
      .optional()
      .describe('장소/지역명 (예: 서울, 강남, 대학로)'),
    genre: z.string().optional().describe('장르 (예: 뮤지컬, 연극)'),
    status: z
      .enum(['공연중', '공연예정'])
      .optional()
      .default('공연중')
      .describe('공연 상태'),
    // 2. RAG 검색 Soft Filter
    vibe_and_content: z
      .string()
      .optional()
      .describe(
        '공연의 분위기, 내용, 줄거리, 평가, 느끼고 싶은 감정 등 (예: "슬프고 감동적인", "스트레스 풀리는", "아이와 가기 좋은")',
      ),
    // 3. [복합값] 범위, 숫자 등
    price_info: z
      .string()
      .optional()
      .describe('가격 관련 정보 (예: 5만원 이하, 무료)'),
  };

  constructor(private readonly performanceService: PerformanceService) {}

  public execute = async (args: {
    date?: string;
    day_of_week?: string;
    region?: string;
    genre?: string;
    status?: '공연중' | '공연예정'; // enum 값은 정확하게
    vibe_and_content?: string;
    price_info?: string;
  }) => {
    const {
      date,
      day_of_week,
      region,
      genre,
      status,
      vibe_and_content,
      price_info,
    } = args;

    const isRagRequired = !!vibe_and_content;

    const results = await this.performanceService.searchUnified({
      date,
      day: day_of_week,
      place: region,
      genre,
      status,
      price: price_info,
      query: vibe_and_content,
      useRag: isRagRequired,
    });

    if (!results || results.length === 0) {
      return {
        content: [
          { type: 'text', text: '조건에 맞는 공연을 찾을 수 없습니다.' },
        ],
      };
    }

    const responseText = results
      .map((p) => {
        return `
---------
[${p.genre || '장르미상'}] ${p.title}
- 요일/시간: ${p.time_info || '상세정보 확인'} (${new Date(p.start_date).toISOString().split('T')[0]} ~ ${new Date(p.end_date).toISOString().split('T')[0]})
- 장소: ${p.place_name}
- 가격: ${p.price || '가격정보 없음'}
- 배우/캐스팅: ${extractActors(p.description) || '상세페이지 참조'} 
- 내용/분위기: ${p.description?.substring(0, 150)}...
- 비고: ${p.status}
---------`;
      })
      .join('\n');

    return {
      content: [{ type: 'text', text: `검색 결과입니다:\n${responseText}` }],
    };
  };
}

function extractActors(description: string): string {
  if (!description) return '';
  const match = description.match(/(출연|캐스팅|배우)[:\s]+([^.,\n]+)/);
  return match ? match[2].trim() : '';
}

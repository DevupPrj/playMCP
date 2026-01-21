import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class KakaoCollector {
  private readonly logger = new Logger(KakaoCollector.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 카카오 로컬 API를 사용하여 주소를 위도/경도로 변환
   */
  async getCoordinates(
    address: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const apiKey = this.configService.get<string>('KAKAO_LOCAL_API');

    if (!apiKey) {
      this.logger.warn('카카오 로컬 API Key 없음 - 위도/경도 변환 건너뜀');
      return null;
    }

    try {
      // 원본 주소 저장 (정제 전)
      const originalAddress = address.trim();

      // 주소 정제: 중복 제거, 공백 정리, 괄호 처리
      let cleanedAddress = originalAddress;

      // 1. 중복된 괄호/대괄호 내용 제거
      cleanedAddress = cleanedAddress.replace(/\(([^)]+)\)\s*\(\1\)/g, '($1)');
      cleanedAddress = cleanedAddress.replace(/\[([^\]]+)\]\s*\[\1\]/g, '[$1]');

      // 2. 전체 중복 패턴 제거
      const parts = cleanedAddress.split(/\s*\(\s*/);
      if (parts.length > 1) {
        const mainPart = parts[0].trim();
        const bracketPart = parts[1]?.replace(/\)/g, '').trim();
        if (
          mainPart === bracketPart ||
          mainPart.includes(bracketPart) ||
          bracketPart?.includes(mainPart)
        ) {
          cleanedAddress = mainPart;
        }
      }

      // 3. 불필요한 공백 제거
      cleanedAddress = cleanedAddress.replace(/\s+/g, ' ').trim();

      // 4. 괄호/대괄호 앞뒤 공백 정리
      cleanedAddress = cleanedAddress
        .replace(/\s*\(\s*/g, '(')
        .replace(/\s*\)\s*/g, ')')
        .replace(/\s*\[\s*/g, '[')
        .replace(/\s*\]\s*/g, ']');

      // 여러 쿼리 시도 (우선순위: 원본 > 정제된 원본 > 변형)
      const queries = [
        originalAddress, // 1순위: 원본 주소 (정제 전)
        cleanedAddress, // 2순위: 정제된 원본 (대괄호 포함)
        cleanedAddress.replace(/\[|\]/g, ''), // 3순위: 대괄호 제거
        cleanedAddress.replace(/\([^)]*\)/g, '').trim(), // 4순위: 소괄호 제거
      ];

      // 5순위: 소괄호 내용만 검색
      const bracketMatches = cleanedAddress.match(/\(([^)]+)\)/g);
      if (bracketMatches && bracketMatches.length > 0) {
        for (const match of bracketMatches) {
          const content = match.replace(/[()]/g, '').trim();
          if (content.length > 0) {
            queries.push(content);
          }
        }
      }

      // 6순위부터: 띄어쓰기 단위로 개별 검색
      const words = cleanedAddress
        .split(/\s+/)
        .filter((word) => word.trim().length > 0);
      for (const word of words) {
        queries.push(word.trim());
      }

      this.logger.log(
        `[카카오 로컬] 원본 주소: "${address}" → 정제된 주소: "${cleanedAddress}"`,
      );
      this.logger.log(
        `[카카오 로컬] 시도할 쿼리 목록 (${queries.length}개): ${queries.map((q, i) => `${i + 1}. "${q}"`).join(', ')}`,
      );

      const url = 'https://dapi.kakao.com/v2/local/search/keyword.json';

      // 첫 번째로 결과가 나오는 쿼리 사용
      for (let i = 0; i < queries.length; i++) {
        const query = queries[i];
        if (!query || query.trim().length === 0) {
          this.logger.log(`[카카오 로컬] 쿼리 ${i + 1}번 스킵 (빈 문자열)`);
          continue;
        }

        this.logger.log(
          `[카카오 로컬] 쿼리 시도 ${i + 1}/${queries.length}: "${query}"`,
        );

        try {
          const { data } = await firstValueFrom(
            this.httpService.get<{
              meta?: {
                total_count?: number;
              };
              documents?: Array<{
                x?: string; // 경도
                y?: string; // 위도
                place_name?: string;
              }>;
            }>(url, {
              params: {
                query: query,
                size: 1, // 첫 번째 결과만 필요
              },
              headers: {
                Authorization: `KakaoAK ${apiKey}`,
              },
            }),
          );

          const place = data?.documents?.[0];
          this.logger.log(
            `[카카오 로컬] 응답 - total_count: ${data?.meta?.total_count || 0}, documents: ${data?.documents?.length || 0}`,
          );

          if (place?.x && place?.y) {
            this.logger.log(
              `[카카오 로컬] ✅ 주소 찾음: "${query}" → 위도: ${place.y}, 경도: ${place.x} (장소명: ${place.place_name})`,
            );
            return {
              latitude: parseFloat(place.y),
              longitude: parseFloat(place.x),
            };
          }

          // 결과가 없으면 다음 쿼리 시도
          if (
            data?.meta?.total_count === 0 ||
            !data?.documents ||
            data.documents.length === 0
          ) {
            this.logger.log(
              `[카카오 로컬] ⚠️ 결과 없음 (total_count: ${data?.meta?.total_count || 0}) - 다음 쿼리 시도`,
            );
            continue;
          }
        } catch (apiError: unknown) {
          // 403 에러 상세 로깅
          if (
            apiError &&
            typeof apiError === 'object' &&
            'response' in apiError
          ) {
            const httpError = apiError as {
              response?: { status?: number; data?: unknown };
            };
            if (httpError.response?.status === 403) {
              this.logger.error(
                `[카카오 로컬] ❌ 403 인증 오류 - 카카오 로컬 API 인증 실패`,
              );
              this.logger.error(
                `[카카오 로컬] 응답 상세: ${JSON.stringify(httpError.response?.data || {})}`,
              );
              // 인증 오류면 더 이상 시도하지 않음
              throw apiError;
            }
          }
          // 다른 에러는 상위 catch로 전달
          throw apiError;
        }
      }

      this.logger.warn(
        `[카카오 로컬] ❌ 모든 쿼리 시도 실패 - 주소를 찾을 수 없음: "${address}" (정제된 주소: "${cleanedAddress}")`,
      );
      return null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown Error';
      this.logger.error(
        `[카카오 로컬] 위도/경도 변환 실패 (${address}): ${errorMessage}`,
      );
      return null;
    }
  }
}

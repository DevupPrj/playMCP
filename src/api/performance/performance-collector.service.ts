import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Performance } from './entities/performance.entity';
import { firstValueFrom } from 'rxjs';
import * as xml2js from 'xml2js';

interface KopisItemRaw {
  mt20id: string[]; // ID
  prfnm: string[]; // 제목
  genrenm: string[]; // 장르
  prfpdfrom: string[]; // 시작일
  prfpdto: string[]; // 종료일
  poster: string[]; // 포스터
  fcltynm: string[]; // 장소
  openrun: string[]; // 오픈런 여부
}

interface KopisDetailRaw {
  mt20id: string[];
  prfnm: string[];
  prfpdfrom: string[];
  prfpdto: string[];
  fcltynm: string[];
  poster: string[];
  genrenm: string[];
  prfstate: string[];
  sty?: string[];
  dtguidance?: string[];
  pcseguidance?: string[];
}

interface KopisResponse<T> {
  dbs: {
    db: T[];
  };
}

@Injectable()
export class PerformanceCollectorService {
  private readonly logger = new Logger(PerformanceCollectorService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(Performance)
    private readonly performanceRepo: Repository<Performance>,
  ) {}

  /**
   * 크론 작업: 매일 새벽 3시에 공연 데이터 수집
   * CronExpression.EVERY_DAY_AT_3AM = '0 3 * * *'
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async collectAll() {
    this.logger.log('🕐 [크론] 데이터 수집 시작');
    await this.collectFromKopis();
    this.logger.log('✅ [크론] 데이터 수집 완료');
  }

  /**
   * 수동 실행용 메서드 (API 엔드포인트에서 호출 가능)
   */
  async collectAllManually() {
    this.logger.log('📝 [수동] 데이터 수집 시작');
    await this.collectFromKopis();
    this.logger.log('✅ [수동] 데이터 수집 완료');
  }

  // ----------------------------------------------------------------
  //  KOPIS 수집 로직 (전체 페이지 순회)
  // ----------------------------------------------------------------
  private async collectFromKopis() {
    const apiKey = this.configService.get<string>('KOPIS_API_KEY');
    if (!apiKey) return this.logger.warn('KOPIS API Key 없음');

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

    const genreCodes = ['AAAA', 'GGGA']; // 연극, 뮤지컬

    for (const genre of genreCodes) {
      let page = 1;
      let isGenreFinished = false;

      this.logger.log(`📚 [${genre}] 수집 시작...`);

      while (!isGenreFinished) {
        try {
          const url = `http://www.kopis.or.kr/openApi/restful/pblprfr`;
          const { data } = await firstValueFrom(
            this.httpService.get<string>(url, {
              params: {
                service: apiKey,
                stdate: today,
                eddate: nextMonth,
                cpage: page,
                rows: 100,
                shcate: genre,
              },
            }),
          );

          const parsed = (await this.parseXml(
            data,
          )) as KopisResponse<KopisItemRaw>;

          const list = parsed?.dbs?.db || [];

          if (list.length === 0) {
            this.logger.log(`
              📚 [${genre}] 모든 페이지 수집 완료 (총 ${page - 1}페이지)
            `);
            isGenreFinished = true;
            break;
          }

          for (const item of list) {
            if (item?.mt20id?.[0]) {
              await this.saveKopisDetail(item.mt20id[0], apiKey, genre);
              await this.sleep(50);
            }
          }
          page++;
          await this.sleep(100);
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : 'Unknown Error';
          this.logger.error(`
            KOPIS 수집 중 에러 (Genre: ${genre}, Page: ${page}): ${errorMessage}
          `);

          isGenreFinished = true;
          break;
        }
      }
    }
  }

  private async saveKopisDetail(
    mt20id: string,
    apiKey: string,
    genreCode: string,
  ) {
    const url = `http://www.kopis.or.kr/openApi/restful/pblprfr/${mt20id}`;
    const { data } = await firstValueFrom(
      this.httpService.get<string>(url, { params: { service: apiKey } }),
    );
    const parsed = (await this.parseXml(data)) as KopisResponse<KopisDetailRaw>;
    const info = parsed?.dbs?.db?.[0];

    if (!info) return;

    const placeName = info.fcltynm?.[0] || '장소 정보 없음';

    // 카카오 로컬 API로 위도/경도 가져오기
    const coordinates = await this.getCoordinatesFromKakaoLocal(placeName);

    const performanceId = info.mt20id?.[0];
    const newData = {
      source: 'KOPIS',
      type: genreCode === 'AAAA' ? 'THEATER' : 'MUSICAL',
      title: info.prfnm?.[0] || '제목 없음',
      start_date: info.prfpdfrom?.[0]
        ? new Date(info.prfpdfrom[0])
        : new Date(),
      end_date: info.prfpdto?.[0] ? new Date(info.prfpdto[0]) : new Date(),
      price: info.pcseguidance?.[0] || '가격 정보 없음',
      time_info: info.dtguidance?.[0] || '시간 정보 없음',
      place_name: placeName,
      latitude: coordinates?.latitude,
      longitude: coordinates?.longitude,
      poster_url: info.poster?.[0] || '포스터 정보 없음',
      genre: info.genrenm?.[0] || '장르 정보 없음',
      status: info.prfstate?.[0] || '정보 없음',
      description: info.sty?.[0] || '시놉시스 없음',
    };

    // 기존 데이터 확인
    const existing = await this.performanceRepo.findOne({
      where: { id: performanceId },
    });

    if (existing) {
      // 값 비교 (updated_at 제외)
      const hasChanges =
        existing.source !== newData.source ||
        existing.type !== newData.type ||
        existing.title !== newData.title ||
        existing.start_date.getTime() !== newData.start_date.getTime() ||
        existing.end_date.getTime() !== newData.end_date.getTime() ||
        existing.price !== newData.price ||
        existing.time_info !== newData.time_info ||
        existing.place_name !== newData.place_name ||
        existing.poster_url !== newData.poster_url ||
        existing.genre !== newData.genre ||
        existing.status !== newData.status ||
        existing.description !== newData.description ||
        (existing.latitude !== null &&
          newData.latitude !== null &&
          parseFloat(existing.latitude.toString()) !== newData.latitude) ||
        (existing.longitude !== null &&
          newData.longitude !== null &&
          parseFloat(existing.longitude.toString()) !== newData.longitude) ||
        (existing.latitude === null && newData.latitude !== null) ||
        (existing.longitude === null && newData.longitude !== null);

      if (!hasChanges) {
        this.logger.log(`[KOPIS] 변경사항 없음 (건너뜀): ${newData.title}`);
        return;
      }

      // 변경된 필드만 업데이트
      await this.performanceRepo.update(performanceId, {
        ...newData,
        updated_at: new Date(),
      });
      this.logger.log(
        `[KOPIS] 업데이트됨: ${newData.title}${coordinates ? ` (위도: ${coordinates.latitude}, 경도: ${coordinates.longitude})` : ''}`,
      );
    } else {
      // 새 데이터 생성
      const entity = this.performanceRepo.create({
        id: performanceId,
        ...newData,
        updated_at: new Date(),
      });
      await this.performanceRepo.save(entity);
      this.logger.log(
        `[KOPIS] 저장됨: ${newData.title}${coordinates ? ` (위도: ${coordinates.latitude}, 경도: ${coordinates.longitude})` : ''}`,
      );
    }
  }

  /**
   * 카카오 로컬 API를 사용하여 주소를 위도/경도로 변환
   */
  private async getCoordinatesFromKakaoLocal(
    address: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const apiKey = this.configService.get<string>('KAKAO_LOCAL_API');

    if (!apiKey) {
      this.logger.warn('카카오 로컬 API Key 없음 - 위도/경도 변환 건너뜀');
      return null;
    }

    try {
      // 주소 정제: 중복 제거, 공백 정리, 괄호 처리
      let cleanedAddress = address.trim();

      // 1. 중복된 괄호/대괄호 내용 제거
      cleanedAddress = cleanedAddress.replace(/\(([^)]+)\)\s*\(\1\)/g, '($1)');
      cleanedAddress = cleanedAddress.replace(/\[([^\]]+)\]\s*\[\1\]/g, '[$1]');

      // 2. 전체 중복 패턴 제거: "롯데시네마 [서울 구로] (롯데시네마 [서울 구로])" → "롯데시네마 [서울 구로]"
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

      // 여러 쿼리 시도 (우선순위: 대괄호 포함 > 대괄호 제거)
      // 대괄호는 지역 정보일 수 있으므로 포함 버전을 우선 시도
      const queries = [
        cleanedAddress, // 1순위: 정제된 원본 (대괄호 포함)
        cleanedAddress.replace(/\[|\]/g, ''), // 2순위: 대괄호 제거 (낮은 우선순위)
        cleanedAddress.replace(/\([^)]*\)/g, '').trim(), // 3순위: 소괄호 제거
      ];

      // 4순위: 소괄호 내용만 검색
      const bracketMatches = cleanedAddress.match(/\(([^)]+)\)/g);
      if (bracketMatches && bracketMatches.length > 0) {
        for (const match of bracketMatches) {
          const content = match.replace(/[()]/g, '').trim(); // 괄호 제거
          if (content.length > 0) {
            queries.push(content); // 소괄호 안의 내용만 검색
          }
        }
      }

      // 5순위부터: 띄어쓰기 단위로 개별 검색
      const words = cleanedAddress
        .split(/\s+/)
        .filter((word) => word.trim().length > 0);
      for (const word of words) {
        queries.push(word.trim()); // 5순위, 6순위, ... 각 단어별로 검색
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

  // ----------------------------------------------------------------
  //  문화포털 수집 로직 (전시, 축제)
  // ----------------------------------------------------------------
  //   private async collectFromCulture() {
  //     const apiKey = this.configService.get<string>('CULTURE_API_KEY');
  //     if (!apiKey) return this.logger.warn('문화포털 API Key 없음');

  //     // 문화포털은 보통 JSON을 지원합니다. (서비스마다 다름, 여기선 JSON 가정)
  //     // * 실제 URL은 서비스 신청한 API 문서 확인 필요 (예시 URL)
  //     const url = `http://api.kcisa.kr/openapi/API_CCA_145/request`;

  //     try {
  //       const { data } = await firstValueFrom(
  //         this.httpService.get(url, {
  //           params: {
  //             serviceKey: apiKey,
  //             numOfRows: 50,
  //             pageNo: 1,
  //             infoTp: '002',
  //           },
  //         }),
  //       );

  //       const items = data?.response?.body?.items?.item || [];

  //       for (const item of items) {
  //         const entity = this.performanceRepo.create({
  //           id: item.uci || item.id,
  //           source: 'CULTURE',
  //           type: item.genre === '전시' ? 'EXHIBITION' : 'FESTIVAL',
  //           title: item.title,
  //           start_date: item.period.split('~')[0].trim(),
  //           end_date: item.period.split('~')[1]?.trim() || item.period,
  //           place_name: item.place,
  //           poster_url: item.referenceIdentifier, // 이미지 URL
  //           genre: item.genre,
  //           status: 'ONGOING',
  //           description: item.description || '',
  //           ticket_link: item.url,
  //           updated_at: new Date(),
  //         });

  //         await this.performanceRepo.save(entity);
  //         this.logger.log(`[Culture] 저장됨: ${entity.title}`);
  //       }
  //     } catch (e) {
  //       this.logger.error(`문화포털 수집 실패: ${e.message}`);
  //     }
  //   }

  private async parseXml(xml: string): Promise<any> {
    const parser = new xml2js.Parser();
    return parser.parseStringPromise(xml);
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

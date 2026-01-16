import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Performance } from './entities/performance.entity';
import { firstValueFrom } from 'rxjs';
import * as xml2js from 'xml2js';
import * as cheerio from 'cheerio';
import { type } from 'os';

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

export interface KopisDetailRaw {
  mt20id: string[]; // 공연 ID
  prfnm: string[]; // 공연명
  prfpdfrom: string[]; // 시작일
  prfpdto: string[]; // 종료일
  fcltynm: string[]; // 장소명
  prfcast?: string[]; // 출연진
  pcseguidance?: string[]; // 가격
  poster?: string[]; // 포스터 URL
  sty?: string[]; // 📜 줄거리 (비어있을 수 있음!)
  genrenm?: string[]; // 장르
  prfstate?: string[]; // 공연 상태
  dtguidance?: string[]; // 공연 시간
  relates?: {
    relate?: {
      relatenm: string[];
      relateurl: string[];
    }[];
  }[];
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

    // 1. KOPIS 상세 API 호출
    const { data } = await firstValueFrom(
      this.httpService.get<string>(url, { params: { service: apiKey } }),
    );

    // 2. XML -> JSON 파싱 (위에서 정의한 인터페이스 사용)
    const parsed = (await this.parseXml(data)) as KopisResponse<KopisDetailRaw>;
    const info = parsed?.dbs?.db?.[0];

    if (!info) return;

    const rawTitle = info.prfnm?.[0] || '제목 없음';
    const cleanTitle = rawTitle
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .trim();
    const title = cleanTitle;

    const placeName = info.fcltynm?.[0] || '장소 정보 없음';

    let description = info.sty?.[0]?.trim();
    const isDescriptionEmpty = !description || description.length < 5;

    const type = genreCode === 'AAAA' ? 'THEATER' : 'MUSICAL';

    if (isDescriptionEmpty) {
      this.logger.log(`🔍 [${title}] 줄거리 없음 -> 네이버 통합 검색 시도...`);
      const searchedDescription = await this.searchDescriptionOnNaver(
        title,
        type,
      );

      if (searchedDescription) {
        description = searchedDescription;
        this.logger.log(
          `[${title}] 줄거리 보강 완료 (${description.length}자)`,
        );
      } else {
        description = 'No contents';
        this.logger.warn(`[${title}] 줄거리 검색 실패`);
      }
    }

    // 📍 [좌표] 카카오 로컬 API
    const coordinates = await this.getCoordinatesFromKakaoLocal(placeName);

    const ticketLink = info.relates?.[0]?.relate?.[0]?.relateurl?.[0] || null;

    const newData = {
      source: 'KOPIS',
      type: type,
      title: title,
      start_date: info.prfpdfrom?.[0]
        ? new Date(info.prfpdfrom[0])
        : new Date(),
      end_date: info.prfpdto?.[0] ? new Date(info.prfpdto[0]) : new Date(),
      price: info.pcseguidance?.[0] || '가격 정보 없음',
      time_info: info.dtguidance?.[0] || '시간 정보 없음',
      place_name: placeName,
      latitude: coordinates?.latitude || undefined,
      longitude: coordinates?.longitude || undefined,
      poster_url: info.poster?.[0] || '포스터 정보 없음',
      genre: info.genrenm?.[0] || '장르 정보 없음',
      status: info.prfstate?.[0] || '정보 없음',
      description: description,
      ticket_link: ticketLink || undefined,
    };

    // --- 👇 기존 데이터 비교 및 저장 로직 ---
    const existing = await this.performanceRepo.findOne({
      where: { id: info.mt20id?.[0] },
    });

    if (existing) {
      const hasChanges =
        existing.source !== newData.source ||
        existing.type !== newData.type ||
        existing.title !== newData.title ||
        new Date(existing.start_date).getTime() !==
          newData.start_date.getTime() ||
        new Date(existing.end_date).getTime() !== newData.end_date.getTime() ||
        existing.price !== newData.price ||
        existing.time_info !== newData.time_info ||
        existing.place_name !== newData.place_name ||
        existing.poster_url !== newData.poster_url ||
        existing.genre !== newData.genre ||
        existing.status !== newData.status ||
        existing.description !== newData.description ||
        existing.ticket_link !== newData.ticket_link;
      if (!hasChanges) {
        return;
      }

      await this.performanceRepo.update(info.mt20id[0], {
        ...newData,
        updated_at: new Date(),
      });
      this.logger.log(`♻️ [Update] ${newData.title}`);
    } else {
      const entity = this.performanceRepo.create({
        id: info.mt20id[0],
        ...newData,
        updated_at: new Date(),
      });
      await this.performanceRepo.save(entity);
      this.logger.log(`✨ [New] ${newData.title}`);
    }
  }

  // 10 단위로 KOPIS 샘플 수집
  public async collectSampleFromKopis(limit: number): Promise<number> {
    const apiKey = this.configService.get<string>('KOPIS_API_KEY');
    if (!apiKey) {
      this.logger.warn('KOPIS API Key 없음');
      return 0;
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '');

    const genreCodes = ['AAAA', 'GGGA']; // 연극, 뮤지컬
    const limitPerGenre = Math.ceil(limit / genreCodes.length); // 장르별 할당량 (10개면 5개씩)
    let totalCollected = 0;

    this.logger.log(`🧪 샘플 수집 시작 (총 목표: ${limit}개)`);

    for (const genre of genreCodes) {
      let currentGenreCount = 0;

      try {
        const url = `http://www.kopis.or.kr/openApi/restful/pblprfr`;
        const { data } = await firstValueFrom(
          this.httpService.get<string>(url, {
            params: {
              service: apiKey,
              stdate: today,
              eddate: nextMonth,
              cpage: 1,
              rows: limitPerGenre,
              shcate: genre,
            },
          }),
        );

        const parsed = (await this.parseXml(
          data,
        )) as KopisResponse<KopisItemRaw>;
        const list = parsed?.dbs?.db || [];

        this.logger.log(`📚 [${genre}] 목록 ${list.length}개 확보. 상세 수집 시작...`);

        for (const item of list) {
          if (item?.mt20id?.[0]) {
            // 상세 정보 수집 및 저장 (기존 메서드 재사용)
            await this.saveKopisDetail(item.mt20id[0], apiKey, genre);
            currentGenreCount++;
            totalCollected++;
            // 너무 빠르면 차단될 수 있으니 살짝 텀 두기
            await this.sleep(100);
          }
        }
      } catch (e) {
        this.logger.error(`샘플 수집 실패 (${genre}): ${e}`);
      }
    }

    this.logger.log(`🧪 샘플 수집 완료. 총 ${totalCollected}개 저장됨.`);
    return totalCollected;
  }

  // 카카오 로컬 API를 사용하여 주소를 위도/경도로 변환하는 로직.
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

  // 네이버 API 호출을 이용해서 공연의 줄거리를 찾는 통합 로직.
  public async searchDescriptionOnNaver(
    title: string,
    type: string,
  ): Promise<string> {
    const clientId = this.configService.get<string>('NAVER_CLIENT_ID');
    const clientSecret = this.configService.get<string>('NAVER_CLIENT_SECRET');

    if (!clientId || !clientSecret) return '';

    // 검색어에서 [뮤지컬], (연극) 같은 괄호 제거
    const cleanTitle = title.replace(/[\[\(].*?[\]\)]/g, '').trim();
    const genrePrefix = type === 'THEATER' ? '연극' : '뮤지컬';

    const searchKeyword = `${genrePrefix} ${cleanTitle}`;

    // [1] 지식백과 검색
    try {
      const encycResult = await this.callNaverApi(
        'encyc',
        searchKeyword,
        clientId,
        clientSecret,
      );
      if (encycResult && this.isTitleMatched(cleanTitle, encycResult.title)) {
        this.logger.log(`지식백과 적중: ${encycResult.title}`);
        return encycResult.description;
      }
    } catch (e) {
      this.logger.warn(`지식백과 검색 패스: ${e}`);
    }

    // [2] 뉴스 검색
    try {
      const newsData = await this.findBestNewsSnippet(searchKeyword);

      if (newsData) {
        this.logger.log(
          `뉴스 스니펫 적중: ${newsData.result.substring(0, 30)}...`,
        );
        return newsData.result;
      }
    } catch (e) {
      this.logger.warn(`뉴스 검색 패스: ${e}`);
    }

    // [3] 블로그 검색
    try {
      const blogQuery = `"${searchKeyword}" 줄거리 -후기 -리뷰`;
      const blogResult = await this.callNaverApi(
        'blog',
        blogQuery,
        clientId,
        clientSecret,
      );
      // 블로그는 추가적으로 제목 검증 필수
      if (blogResult && this.isTitleMatched(cleanTitle, blogResult.title)) {
        this.logger.log(`블로그 적중: ${blogResult.title}`);
        return this.cleanHtml(blogResult.description);
      }
    } catch (e) {
      this.logger.warn(`블로그 검색 패스: ${e}`);
    }

    return '';
  }

  // 네이버 API 호출 로직
  private async callNaverApi(
    type: 'blog' | 'encyc',
    query: string,
    id: string,
    secret: string,
  ): Promise<{ title: string; description: string } | null> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(
          `https://openapi.naver.com/v1/search/${type}.json`,
          {
            headers: {
              'X-Naver-Client-Id': id,
              'X-Naver-Client-Secret': secret,
            },
            params: {
              query: query,
              display: 1,
              sort: 'sim',
            },
          },
        ),
      );

      if (data.items && data.items.length > 0) {
        const item = data.items[0];
        return {
          title: this.cleanHtml(item.title),
          description: this.cleanHtml(item.description),
        };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // KOPIS API 응답 객체 검증용 서비스 로직
  public async getRawKopisDetail(mt20id: string) {
    const apiKey = this.configService.get<string>('KOPIS_API_KEY');
    const url = `http://www.kopis.or.kr/openApi/restful/pblprfr/${mt20id}`;

    // 1. KOPIS 호출
    const { data } = await firstValueFrom(
      this.httpService.get(url, { params: { service: apiKey } })
    );

    // 2. XML -> JSON 변환
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(data);

    // 3. 변환된 Raw Data 리턴
    // (보통 result.dbs.db[0] 안에 내용이 다 들어있습니다)
    return result;
  }

  // 네이버 뉴스 api를 호출하고 시놉시스 문자열을 선택하는 로직
  public async findBestNewsSnippet(
    keyword: string,
  ): Promise<{ type: string; source: string; result: string } | null> {
    const query = `"${keyword}" (줄거리 | 시놉시스 | 내용)`;
    const { data } = await firstValueFrom(
      this.httpService.get('https://openapi.naver.com/v1/search/news.json', {
        headers: {
          'X-Naver-Client-Id':
            this.configService.get<string>('NAVER_CLIENT_ID'),
          'X-Naver-Client-Secret': this.configService.get<string>(
            'NAVER_CLIENT_SECRET',
          ),
        },
        params: {
          query: query,
          display: 10,
          sort: 'sim',
        },
      }),
    );

    if (!data.items || data.items.length === 0) return null;

    const bestItem = this.selectBestItem(data.items);
    if (bestItem) {
      return {
        type: 'NAVER_API_SNIPPET',
        source: this.cleanHtml(bestItem.title),
        result: this.cleanHtml(bestItem.description),
      };
    }

    return null;
  }

  // 여러 개의 뉴스 중 가장 좋은 요약 내용을 선택하는 로직
  private selectBestItem(items: any[]): any {
    const candidates = items.map(item => {
      let score = 0;
      const text = this.cleanHtml(item.description);
      const title = this.cleanHtml(item.title);

      // 블랙리스트
      const spamKeywords = ['랭키파이', '트렌드', '순위', '할인', '티켓오픈', '캐스팅', '독후감', '발매'];
      if (spamKeywords.some(k => text.includes(k) || title.includes(k))) {
        score -= 100;
      }

      // 화이트리스트
      const plotKeywords = ['줄거리', '시놉시스', '내용은', '사건', '배경', '그린', '다룬', '이야기'];
      plotKeywords.forEach(k => {
        if (text.includes(k)) score += 10;
      });

      // 서술형이면 가점
      if (text.match(/다\./)) score += 20;

      // 너무 짧으면 정보량 부족
      if (text.length < 30) score -= 20;

      return { item, score };
    });

    // 점수 높은 순 정렬
    candidates.sort((a, b) => b.score - a.score);

    // 1등의 점수가 0점보다는 높아야 의미가 있음
    return candidates[0].score > 0 ? candidates[0].item : null;
  }

  // Meta Description 크롤링 서비스 로직
  public async fetchMetaDescription(url: string): Promise<string> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          timeout: 3000,
        }),
      );

      // 2. Cheerio 파싱
      const $ = cheerio.load(data);

      // 3. 메타 태그 찾기
      let metaDesc = $('meta[property="og:description"]').attr('content') ||
                     $('meta[name="description"]').attr('content') ||
                     $('meta[name="twitter:description"]').attr('content');

      if (!metaDesc) return '❌ 메타 태그 없음';

      return metaDesc.trim();
    } catch (e) {
      return `에러 발생: ${e}`;
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

  private cleanHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/<[^>]*>?/gm, '') // HTML 태그 제거
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();
  }

  private isTitleMatched(query: string, resultTitle: string): boolean {
    if (!query || !resultTitle) return false;
    const normalize = (s: string) => s.replace(/[\s\[\]\(\)\-\.]/g, '').toLowerCase();
    return normalize(resultTitle).includes(normalize(query));
  }
}

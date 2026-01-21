import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Performance } from './entities/performance.entity';
import { KopisCollector } from './collectors/kopis.collector';
import { NaverCollector } from './collectors/naver.collector';
import { KakaoCollector } from './collectors/kakao.collector';
import { SleepUtil } from './collectors/utils/sleep.util';
import { CrawlerUtil } from './collectors/utils/crawler.util';

@Injectable()
export class PerformanceCollectorService {
  private readonly logger = new Logger(PerformanceCollectorService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(Performance)
    private readonly performanceRepo: Repository<Performance>,
    private readonly kopisCollector: KopisCollector,
    private readonly naverCollector: NaverCollector,
    private readonly kakaoCollector: KakaoCollector,
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
          const list = await this.kopisCollector.fetchPerformanceList(
            genre,
            page,
            today,
            nextMonth,
          );

          if (list.length === 0) {
            this.logger.log(`
              📚 [${genre}] 모든 페이지 수집 완료 (총 ${page - 1}페이지)
            `);
            isGenreFinished = true;
            break;
          }

          for (const item of list) {
            if (item?.mt20id?.[0]) {
              await this.saveKopisDetail(item.mt20id[0], genre);
              await SleepUtil.sleep(50);
            }
          }
          page++;
          await SleepUtil.sleep(100);
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

  private async saveKopisDetail(mt20id: string, genreCode: string) {
    // 1. KOPIS 상세 API 호출
    const info = await this.kopisCollector.fetchPerformanceDetail(mt20id);
    if (!info) return;

    // 2. KOPIS 데이터를 Performance 형태로 변환
    const baseData = this.kopisCollector.transformKopisDetailToPerformance(
      info,
      genreCode,
    );
    const title = baseData.title;
    const placeName = baseData.place_name;

    // 3. 줄거리 보강 (네이버 검색)
    let description = baseData.description;
    const isDescriptionEmpty = !description || description.length < 5;

    if (isDescriptionEmpty) {
      this.logger.log(`🔍 [${title}] 줄거리 없음 -> 네이버 통합 검색 시도...`);
      const searchedDescription = await this.naverCollector.searchDescription(
        title,
        baseData.type,
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

    // 4. 좌표 변환 (카카오 로컬 API)
    const coordinates = await this.kakaoCollector.getCoordinates(placeName);

    const newData = {
      ...baseData,
      description: description,
      latitude: coordinates?.latitude || undefined,
      longitude: coordinates?.longitude || undefined,
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
        const list = await this.kopisCollector.fetchPerformanceList(
          genre,
          1,
          today,
          nextMonth,
        );

        this.logger.log(
          `📚 [${genre}] 목록 ${list.length}개 확보. 상세 수집 시작...`,
        );

        for (const item of list) {
          if (item?.mt20id?.[0]) {
            // 상세 정보 수집 및 저장 (기존 메서드 재사용)
            await this.saveKopisDetail(item.mt20id[0], genre);
            currentGenreCount++;
            totalCollected++;
            // 너무 빠르면 차단될 수 있으니 살짝 텀 두기
            await SleepUtil.sleep(100);
          }
        }
      } catch (e) {
        this.logger.error(`샘플 수집 실패 (${genre}): ${e}`);
      }
    }

    this.logger.log(`🧪 샘플 수집 완료. 총 ${totalCollected}개 저장됨.`);
    return totalCollected;
  }

  // KOPIS API 응답 객체 검증용 서비스 로직
  public async getRawKopisDetail(mt20id: string) {
    return this.kopisCollector.getRawKopisDetail(mt20id);
  }

  // 네이버 뉴스 api를 호출하고 시놉시스 문자열을 선택하는 로직
  public async findBestNewsSnippet(
    keyword: string,
  ): Promise<{ type: string; source: string; result: string } | null> {
    return this.naverCollector.findBestNewsSnippet(keyword);
  }

  // 네이버 API 호출을 이용해서 공연의 줄거리를 찾는 통합 로직 (하위 호환성)
  public async searchDescriptionOnNaver(
    title: string,
    type: string,
  ): Promise<string> {
    return this.naverCollector.searchDescription(title, type);
  }

  // Meta Description 크롤링 서비스 로직
  public async fetchMetaDescription(url: string): Promise<string> {
    return CrawlerUtil.fetchMetaDescription(this.httpService, url);
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
}

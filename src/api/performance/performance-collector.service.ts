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

    const entity = this.performanceRepo.create({
      id: info.mt20id?.[0],
      source: 'KOPIS',
      type: genreCode === 'AAAA' ? 'THEATER' : 'MUSICAL',
      title: info.prfnm?.[0] || '제목 없음',
      start_date: info.prfpdfrom?.[0]
        ? new Date(info.prfpdfrom[0])
        : new Date(),
      end_date: info.prfpdto?.[0] ? new Date(info.prfpdto[0]) : new Date(),
      price: info.pcseguidance?.[0] || '가격 정보 없음',
      time_info: info.dtguidance?.[0] || '시간 정보 없음',
      place_name: info.fcltynm?.[0] || '장소 정보 없음',
      poster_url: info.poster?.[0] || '포스터 정보 없음',
      genre: info.genrenm?.[0] || '장르 정보 없음',
      status: info.prfstate?.[0] || '정보 없음',
      description: info.sty?.[0] || '시놉시스 없음',
      updated_at: new Date(),
    });

    await this.performanceRepo.save(entity);
    this.logger.log(`[KOPIS] 저장됨: ${entity.title}`);
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

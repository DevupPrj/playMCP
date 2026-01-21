import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  KopisItemRaw,
  KopisDetailRaw,
  KopisResponse,
} from './types/kopis.types';
import { XmlParserUtil } from './utils/xml-parser.util';
import { SleepUtil } from './utils/sleep.util';

@Injectable()
export class KopisCollector {
  private readonly logger = new Logger(KopisCollector.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * KOPIS API에서 공연 목록을 가져옵니다
   */
  async fetchPerformanceList(
    genreCode: string,
    page: number,
    startDate: string,
    endDate: string,
  ): Promise<KopisItemRaw[]> {
    const apiKey = this.configService.get<string>('KOPIS_API_KEY');
    if (!apiKey) {
      throw new Error('KOPIS API Key 없음');
    }

    const url = `http://www.kopis.or.kr/openApi/restful/pblprfr`;
    const { data } = await firstValueFrom(
      this.httpService.get<string>(url, {
        params: {
          service: apiKey,
          stdate: startDate,
          eddate: endDate,
          cpage: page,
          rows: 100,
          shcate: genreCode,
        },
      }),
    );

    const parsed = (await XmlParserUtil.parseXml(
      data,
    )) as KopisResponse<KopisItemRaw>;
    return parsed?.dbs?.db || [];
  }

  /**
   * KOPIS API에서 공연 상세 정보를 가져옵니다
   */
  async fetchPerformanceDetail(mt20id: string): Promise<KopisDetailRaw | null> {
    const apiKey = this.configService.get<string>('KOPIS_API_KEY');
    if (!apiKey) {
      throw new Error('KOPIS API Key 없음');
    }

    const url = `http://www.kopis.or.kr/openApi/restful/pblprfr/${mt20id}`;
    const { data } = await firstValueFrom(
      this.httpService.get<string>(url, { params: { service: apiKey } }),
    );

    const parsed = (await XmlParserUtil.parseXml(
      data,
    )) as KopisResponse<KopisDetailRaw>;
    return parsed?.dbs?.db?.[0] || null;
  }

  /**
   * KOPIS API Raw 데이터를 가져옵니다 (테스트용)
   */
  async getRawKopisDetail(mt20id: string) {
    const apiKey = this.configService.get<string>('KOPIS_API_KEY');
    const url = `http://www.kopis.or.kr/openApi/restful/pblprfr/${mt20id}`;

    const { data } = await firstValueFrom(
      this.httpService.get(url, { params: { service: apiKey } }),
    );

    return XmlParserUtil.parseXml(data);
  }

  /**
   * KOPIS 상세 정보를 Performance 엔티티 형태로 변환합니다
   */
  transformKopisDetailToPerformance(
    info: KopisDetailRaw,
    genreCode: string,
  ): {
    source: string;
    type: string;
    title: string;
    start_date: Date;
    end_date: Date;
    price: string;
    time_info: string;
    place_name: string;
    poster_url: string;
    genre: string;
    status: string;
    description: string;
    ticket_link: string | undefined;
  } {
    const rawTitle = info.prfnm?.[0] || '제목 없음';
    const cleanTitle = rawTitle
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .trim();
    const title = cleanTitle;

    const placeName = info.fcltynm?.[0] || '장소 정보 없음';
    const type = genreCode === 'AAAA' ? 'THEATER' : 'MUSICAL';
    const ticketLink =
      info.relates?.[0]?.relate?.[0]?.relateurl?.[0] || undefined;

    return {
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
      poster_url: info.poster?.[0] || '포스터 정보 없음',
      genre: info.genrenm?.[0] || '장르 정보 없음',
      status: info.prfstate?.[0] || '정보 없음',
      description: info.sty?.[0]?.trim() || '',
      ticket_link: ticketLink,
    };
  }
}

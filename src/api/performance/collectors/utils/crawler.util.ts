import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';

export class CrawlerUtil {
  /**
   * Meta Description 크롤링
   */
  static async fetchMetaDescription(
    httpService: HttpService,
    url: string,
  ): Promise<string> {
    try {
      const { data } = await firstValueFrom(
        httpService.get(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          },
          timeout: 3000,
        }),
      );

      // Cheerio 파싱
      const $ = cheerio.load(data);

      // 메타 태그 찾기
      const metaDesc =
        $('meta[property="og:description"]').attr('content') ||
        $('meta[name="description"]').attr('content') ||
        $('meta[name="twitter:description"]').attr('content');

      if (!metaDesc) return '❌ 메타 태그 없음';

      return metaDesc.trim();
    } catch (e) {
      return `에러 발생: ${e}`;
    }
  }
}

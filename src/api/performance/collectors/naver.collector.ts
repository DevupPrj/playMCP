import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HtmlCleanerUtil } from './utils/html-cleaner.util';
import { TextMatcherUtil } from './utils/text-matcher.util';

@Injectable()
export class NaverCollector {
  private readonly logger = new Logger(NaverCollector.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 네이버 API를 이용해서 공연의 줄거리를 찾는 통합 로직
   */
  async searchDescription(title: string, type: string): Promise<string> {
    const clientId = this.configService.get<string>('NAVER_CLIENT_ID');
    const clientSecret = this.configService.get<string>('NAVER_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      this.logger.warn(`[${title}] 네이버 API 인증 정보 없음 - 검색 건너뜀`);
      return '';
    }

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
      if (
        encycResult &&
        TextMatcherUtil.isTitleMatched(cleanTitle, encycResult.title)
      ) {
        this.logger.log(`지식백과 적중: ${encycResult.title}`);
        return encycResult.description;
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[${title}] 지식백과 검색 실패: ${errorMessage}`);
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
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[${title}] 뉴스 검색 실패: ${errorMessage}`);
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
      if (
        blogResult &&
        TextMatcherUtil.isTitleMatched(cleanTitle, blogResult.title)
      ) {
        this.logger.log(`블로그 적중: ${blogResult.title}`);
        return HtmlCleanerUtil.cleanHtml(blogResult.description);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.warn(`[${title}] 블로그 검색 실패: ${errorMessage}`);
    }

    this.logger.warn(`[${title}] 모든 네이버 검색 실패 또는 결과 없음`);
    return '';
  }

  /**
   * 네이버 API 호출 로직
   */
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
          title: HtmlCleanerUtil.cleanHtml(item.title),
          description: HtmlCleanerUtil.cleanHtml(item.description),
        };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  /**
   * 네이버 뉴스 API를 호출하고 시놉시스 문자열을 선택하는 로직
   */
  async findBestNewsSnippet(
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
        source: HtmlCleanerUtil.cleanHtml(bestItem.title),
        result: HtmlCleanerUtil.cleanHtml(bestItem.description),
      };
    }

    return null;
  }

  /**
   * 여러 개의 뉴스 중 가장 좋은 요약 내용을 선택하는 로직
   */
  private selectBestItem(items: any[]): any {
    const candidates = items.map((item) => {
      let score = 0;
      const text = HtmlCleanerUtil.cleanHtml(item.description);
      const title = HtmlCleanerUtil.cleanHtml(item.title);

      // 블랙리스트
      const spamKeywords = [
        '랭키파이',
        '트렌드',
        '순위',
        '할인',
        '티켓오픈',
        '캐스팅',
        '독후감',
        '발매',
      ];
      if (spamKeywords.some((k) => text.includes(k) || title.includes(k))) {
        score -= 100;
      }

      // 화이트리스트
      const plotKeywords = [
        '줄거리',
        '시놉시스',
        '내용은',
        '사건',
        '배경',
        '그린',
        '다룬',
        '이야기',
      ];
      plotKeywords.forEach((k) => {
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
}

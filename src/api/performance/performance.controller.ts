import { Controller, Get, Post, Query } from '@nestjs/common';
import { PerformanceCollectorService } from './performance-collector.service';

@Controller('performances')
export class PerformancesController {
  constructor(
    private readonly collectorService: PerformanceCollectorService,
  ) {}

  @Post('collect')
  async triggerCollection() {
    await this.collectorService.collectAllManually();
    return { message: '데이터 수집이 시작되었습니다. 로그를 확인하세요.' };
  }

  @Get('collect-unit')
  async collectTest(@Query('limit') limit: number = 10) {
    const count = await this.collectorService.collectSampleFromKopis(limit);
    return {
      status: 'SUCCESS',
      message: `테스트 수집 완료: 총 ${count}개`,
    };
  }

  @Get('naver-test')
  async testNaver(@Query('query') query: string) {
    if (!query) return { message: '검색어를 입력해주세요. (?query=공연명)' };

    const result = await this.collectorService.searchDescriptionOnNaver(
      query,
      'THEATER',
    );

    return {
      keyword: query,
      result_length: result.length,
      clean_text: result,
    };
  }

  @Get('kopis-raw')
  async getRawKopis(@Query('id') id: string) {
    if (!id) return { message: 'KOPIS 공연 ID(mt20id)를 입력해주세요.' };

    return this.collectorService.getRawKopisDetail(id);
  }

  @Get('crawl-test')
  async testCrawl(@Query('url') url: string) {
    if (!url) return { message: '테스트할 URL을 입력해주세요. (?url=주소)' };

    const result = await this.collectorService.fetchMetaDescription(url);

    return {
      target_url: url,
      crawled_description: result,
      length: result.length,
    };
  }

  @Get('news-test')
  async testNews(@Query('query') query: string) {
    if (!query) return { message: '검색어를 입력해주세요.' };

    const data = await this.collectorService.findBestNewsSnippet(query);

    if (!data) {
      return {
        status: 'FAIL',
        search_keyword: query,
        method: 'NONE',
        source_title: '',
        summary: '검색 결과 없음',
        length: 0,
      };
    }

    return {
      status: 'SUCCESS',
      search_keyword: query,
      method: data.type,
      source_title: data.source,
      summary: data.result,
      length: data.result.length,
    };
  }

}

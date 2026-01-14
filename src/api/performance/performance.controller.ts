import { Controller, Post } from '@nestjs/common';
import { PerformanceCollectorService } from './performance-collector.service';

@Controller('performances')
export class PerformancesController {
  constructor(private readonly collectorService: PerformanceCollectorService) {}

  @Post('collect')
  async triggerCollection() {
    await this.collectorService.collectAllManually();
    return { message: '데이터 수집이 시작되었습니다. 로그를 확인하세요.' };
  }
}

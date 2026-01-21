import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PerformanceService } from './performance.service';
import { Performance } from './entities/performance.entity';
import { PerformanceCollectorService } from './performance-collector.service';
import { PerformancesController } from './performance.controller';
import { HttpModule } from '@nestjs/axios';
import { KopisCollector } from './collectors/kopis.collector';
import { NaverCollector } from './collectors/naver.collector';
import { KakaoCollector } from './collectors/kakao.collector';

@Module({
  imports: [TypeOrmModule.forFeature([Performance]), HttpModule],
  controllers: [PerformancesController],
  providers: [
    PerformanceService,
    PerformanceCollectorService,
    KopisCollector,
    NaverCollector,
    KakaoCollector,
  ],
  exports: [PerformanceService],
})
export class PerformanceModule {}

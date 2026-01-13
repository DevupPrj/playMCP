import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PerformanceService } from './performance.service';
import { Performance } from './entities/performance.entity';
import { PerformanceCollectorService } from './performance-collector.service';
import { PerformancesController } from './performance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Performance])],
  controllers: [PerformancesController],
  providers: [PerformanceService, PerformanceCollectorService],
  exports: [PerformanceService],
})
export class PerformanceModule {}

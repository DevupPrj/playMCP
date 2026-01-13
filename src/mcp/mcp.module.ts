import { Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { PerformanceModule } from '../domains/performance/performance.module';

@Module({
  imports: [PerformanceModule],
  providers: [McpService],
})
export class McpModule {}

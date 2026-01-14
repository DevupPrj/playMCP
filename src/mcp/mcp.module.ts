import { Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { PerformanceModule } from '../domains/performance/performance.module';
import { SearchTool } from './tools/search.tool';

@Module({
  imports: [PerformanceModule],
  providers: [McpService, SearchTool],
})
export class McpModule {}

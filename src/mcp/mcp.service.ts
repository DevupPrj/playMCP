import { Injectable, OnModuleInit } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PerformanceService } from '../domains/performance/performance.service';

@Injectable()
export class McpService implements OnModuleInit {
  private mcpServer: McpServer;

  constructor(private readonly performanceService: PerformanceService) {
    this.mcpServer = new McpServer({
      name: 'Culture-MCP',
      version: '1.0.0',
    });
  }

  async onModuleInit() {
    this.registerTools();
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error('✅ MCP Server connected via Stdio');
  }

  private registerTools() {
    this.mcpServer.tool(
      'search_culture_events',
      {
        keyword: z.string().describe('검색어 (제목, 장르 등)'),
        status: z
          .enum(['공연중', '공연예정'])
          .optional()
          .describe('공연 상태 (기본: 공연중)'),
      },
      async ({ keyword, status = '공연중' }) => {
        const results = await this.performanceService.search(keyword, status);
        if (results.length === 0) {
          return { content: [{ type: 'text', text: '검색 결과가 없습니다.' }] };
        }

        const responseText = results
          .map(
            (p) =>
              `[${p.genre}] ${p.title} (${p.start_date.toISOString().split('T')[0]} ~ ${p.end_date.toISOString().split('T')[0]})`,
          )
          .join('\n');

        return {
          content: [{ type: 'text', text: responseText }],
        };
      },
    );
  }
}

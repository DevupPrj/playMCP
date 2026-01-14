import { Injectable, OnModuleInit } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PerformanceService } from '../domains/performance/performance.service';
import { SearchTool } from './tools/search.tool';

@Injectable()
export class McpService implements OnModuleInit {
  private mcpServer: McpServer;

  constructor(
    private readonly performanceService: PerformanceService,
    private readonly searchTool: SearchTool,
  ) {
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
      this.searchTool.name,
      this.searchTool.schema,
      this.searchTool.execute,
    );
  }
}

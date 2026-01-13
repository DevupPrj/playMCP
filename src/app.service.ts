import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealthStatus() {
    return {
      server: 'PlayMCP Server',
      status: 'OK',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}

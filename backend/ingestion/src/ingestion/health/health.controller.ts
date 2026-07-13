import { Controller, Get } from '@nestjs/common';

@Controller('ingestion')
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'martinrea-ap-ingestion',
      uptimeSec: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    };
  }
}

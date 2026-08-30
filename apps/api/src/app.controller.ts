import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('ready')
  ready() {
    return this.appService.getReady();
  }

  /**
   * Infra scrape target. Lives on AppController (no JWT) so it does not collide
   * with the auth-gated business MetricsModule at GET /metrics/*.
   */
  @Get('metrics/prometheus')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  prometheus() {
    return this.appService.getPrometheusMetrics();
  }
}

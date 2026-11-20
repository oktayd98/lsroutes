import * as common from '@nestjs/common';
import { Controller, Get, Post, VERSION_NEUTRAL } from '@nestjs/common';

@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @common.Get() // GET /health (excluded from the global prefix, no version)
  check() {}
}

@Controller('webhooks')
export class WebhooksController {
  @Post('stripe') // POST /v1/webhooks/stripe (excluded for POST only)
  stripe() {}

  @Get('status') // GET /api/v1/webhooks/status
  status() {}
}

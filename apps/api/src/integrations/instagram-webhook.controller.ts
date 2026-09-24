import { Body, Controller, Get, Header, HttpCode, Inject, Post, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { InstagramWebhookService } from './instagram-webhook.service.js';

@Public()
@Controller('webhooks/instagram')
export class InstagramWebhookController {
  constructor(
    @Inject(InstagramWebhookService) private readonly webhooks: InstagramWebhookService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  verify(@Query() query: Readonly<Record<string, unknown>>): string {
    return this.webhooks.verifySubscription(query);
  }

  @Post()
  @HttpCode(200)
  accept(@Body() body: unknown) {
    return this.webhooks.accept(body);
  }
}

import { Controller, Get, Post, Body } from '@nestjs/common';
import { ScraperService } from './scraper.service';

@Controller('scraper')
export class ScraperController {
  constructor(private readonly service: ScraperService) {}

  @Get('status')
  status() {
    return this.service.getStatus();
  }

  @Post('backfill')
  backfill(@Body() body: { keywordId?: number; pages?: number }) {
    return this.service.backfill(body?.keywordId, body?.pages ?? 20);
  }

  @Post('backfill-mistral')
  backfillMistral(@Body() body: { limit?: number }) {
    return this.service.backfillMistral(body?.limit ?? 200);
  }
}

import { Controller, Get, Post, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ScraperService } from './scraper.service';

@Controller('scraper')
export class ScraperController {
  constructor(private readonly service: ScraperService) {}

  @Get('status')
  status() {
    return this.service.getStatus();
  }

  @Get('listings/:id/details')
  listingDetails(@Param('id', ParseIntPipe) id: number) {
    return this.service.getListingDetails(id);
  }

  @Post('pause')
  pause() {
    return this.service.setPaused(true);
  }

  @Post('resume')
  resume() {
    return this.service.setPaused(false);
  }

  @Post('backfill')
  backfill(@Body() body: { keywordId?: number; pages?: number }) {
    return this.service.backfill(body?.keywordId, body?.pages ?? 20);
  }
}

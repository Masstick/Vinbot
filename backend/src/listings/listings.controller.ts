import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ListingsService } from './listings.service';

@Controller('listings')
export class ListingsController {
  constructor(private readonly service: ListingsService) {}

  @Get()
  findAll(@Query('keyword_id') keywordId?: string) {
    return this.service.getListings(keywordId ? parseInt(keywordId) : undefined);
  }

  @Get('opportunities')
  getOpportunities(@Query('keyword_id') keywordId?: string) {
    return this.service.getOpportunities(keywordId ? parseInt(keywordId) : undefined);
  }

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.getListing(id);
  }

  @Get(':id/history')
  getHistory(@Param('id', ParseIntPipe) id: number) {
    return this.service.getPriceHistory(id);
  }
}

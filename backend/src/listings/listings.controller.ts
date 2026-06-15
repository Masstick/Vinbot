import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ListingsService } from './listings.service';

@Controller('listings')
export class ListingsController {
  constructor(private readonly service: ListingsService) {}

  @Get()
  findAll(
    @Query('keyword_id') keywordId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('country') country?: string,
    @Query('q') q?: string,
    @Query('max_age_hours') maxAgeHours?: string,
    @Query('solo_seller') soloSeller?: string,
  ) {
    return this.service.getListings({
      keywordId: keywordId ? parseInt(keywordId) : undefined,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      country: country || undefined,
      q: q || undefined,
      maxAgeHours: maxAgeHours ? parseInt(maxAgeHours) : undefined,
      soloSeller: soloSeller === '1' || soloSeller === 'true',
    });
  }

  @Get('opportunities')
  getOpportunities(@Query('keyword_id') keywordId?: string, @Query('limit') limit?: string) {
    return this.service.getOpportunities(keywordId ? parseInt(keywordId) : undefined, limit ? parseInt(limit) : 50);
  }

  @Get('validated')
  getValidated(@Query('limit') limit?: string) {
    return this.service.getValidated(limit ? parseInt(limit) : 50);
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

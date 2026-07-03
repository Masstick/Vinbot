import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Listing } from './listing.entity';
import { KeywordListing } from './keyword-listing.entity';
import { PriceHistory } from './price-history.entity';
import { ProductTypeStats } from './product-type-stats.entity';
import { ListingsService } from './listings.service';
import { ListingsController } from './listings.controller';
import { ProductClassifierService } from './product-classifier.service';
import { ProductTypeStatsService } from './product-type-stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Listing, KeywordListing, PriceHistory, ProductTypeStats])],
  providers: [ListingsService, ProductClassifierService, ProductTypeStatsService],
  controllers: [ListingsController],
  exports: [ListingsService, ProductClassifierService, ProductTypeStatsService],
})
export class ListingsModule {}

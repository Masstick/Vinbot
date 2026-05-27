import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScraperService } from './scraper.service';
import { ScraperController } from './scraper.controller';
import { KeywordsModule } from '../keywords/keywords.module';
import { ListingsModule } from '../listings/listings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [ScheduleModule.forRoot(), KeywordsModule, ListingsModule, NotificationsModule, AnalysisModule],
  providers: [ScraperService],
  controllers: [ScraperController],
})
export class ScraperModule {}

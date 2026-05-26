import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KeywordsModule } from './keywords/keywords.module';
import { ListingsModule } from './listings/listings.module';
import { ScraperModule } from './scraper/scraper.module';
import { NotificationsModule } from './notifications/notifications.module';
import { Keyword } from './keywords/keyword.entity';
import { Listing } from './listings/listing.entity';
import { KeywordListing } from './listings/keyword-listing.entity';
import { PriceHistory } from './listings/price-history.entity';
import { NotificationLog } from './notifications/notification-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get('DB_HOST', 'localhost'),
        port: parseInt(cfg.get('DB_PORT', '5432')),
        database: cfg.get('DB_NAME', 'vinbot'),
        username: cfg.get('DB_USER', 'postgres'),
        password: cfg.get('DB_PASSWORD', 'changeme'),
        entities: [Keyword, Listing, KeywordListing, PriceHistory, NotificationLog],
        synchronize: false,
        logging: false,
      }),
    }),
    KeywordsModule,
    ListingsModule,
    ScraperModule,
    NotificationsModule,
  ],
})
export class AppModule {}

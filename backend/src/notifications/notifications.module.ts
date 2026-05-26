import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationLog } from './notification-log.entity';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { DealsGateway } from './deals.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationLog])],
  providers: [TelegramService, DealsGateway],
  controllers: [TelegramController],
  exports: [TelegramService, DealsGateway],
})
export class NotificationsModule {}

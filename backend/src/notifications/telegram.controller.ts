import { Body, Controller, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly service: TelegramService) {}

  @Post('test')
  test(@Body('chat_id') chatId: string) {
    return this.service.sendTest(chatId);
  }
}

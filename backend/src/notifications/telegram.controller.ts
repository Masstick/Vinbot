import { Controller, Post } from '@nestjs/common';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly service: TelegramService) {}

  @Post('test')
  test() {
    return this.service.sendTest();
  }
}

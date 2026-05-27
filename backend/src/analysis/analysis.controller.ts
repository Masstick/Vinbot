import { Controller, Post } from '@nestjs/common';
import { MistralService } from './mistral.service';

@Controller('mistral')
export class AnalysisController {
  constructor(private readonly mistral: MistralService) {}

  @Post('test')
  test() {
    return this.mistral.testConnection();
  }
}

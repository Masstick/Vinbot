import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealAnalysis } from './deal-analysis.entity';
import { ModelMarketAvg } from './model-market-avg.entity';
import { MistralService } from './mistral.service';
import { AnalysisController } from './analysis.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DealAnalysis, ModelMarketAvg])],
  providers: [MistralService],
  controllers: [AnalysisController],
  exports: [MistralService, TypeOrmModule],
})
export class AnalysisModule {}

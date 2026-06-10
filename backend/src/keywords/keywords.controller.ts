import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, ValidationPipe } from '@nestjs/common';
import { KeywordsService } from './keywords.service';
import { CreateKeywordDto } from './dto/create-keyword.dto';
import { DealsGateway } from '../notifications/deals.gateway';

@Controller('keywords')
export class KeywordsController {
  constructor(
    private readonly service: KeywordsService,
    private readonly gateway: DealsGateway,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  async create(@Body(ValidationPipe) dto: CreateKeywordDto) {
    const kw = await this.service.create(dto);
    this.gateway.emitKeywordChanged();
    return kw;
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body(ValidationPipe) dto: CreateKeywordDto) {
    const kw = await this.service.update(id, dto);
    this.gateway.emitKeywordChanged();
    return kw;
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    this.gateway.emitKeywordChanged();
  }
}

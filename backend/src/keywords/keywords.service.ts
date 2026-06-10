import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Keyword } from './keyword.entity';
import { CreateKeywordDto } from './dto/create-keyword.dto';

@Injectable()
export class KeywordsService {
  constructor(
    @InjectRepository(Keyword)
    private readonly repo: Repository<Keyword>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(): Promise<Keyword[]> {
    return this.repo.find({ order: { created_at: 'DESC' } });
  }

  findActive(): Promise<Keyword[]> {
    return this.repo.find({ where: { active: true }, order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<Keyword> {
    const kw = await this.repo.findOneBy({ id });
    if (!kw) throw new NotFoundException(`Keyword ${id} not found`);
    return kw;
  }

  create(dto: CreateKeywordDto): Promise<Keyword> {
    const kw = this.repo.create(dto);
    return this.repo.save(kw);
  }

  async update(id: number, dto: Partial<CreateKeywordDto>): Promise<Keyword> {
    await this.findOne(id);
    await this.repo.update(id, { ...dto, updated_at: new Date() });
    const updated = await this.findOne(id);
    // Recalcule potential_profit pour toutes les annonces du mot-clé avec le nouveau shipping_estimate
    await this.dataSource.query(
      `UPDATE keyword_listings kl
       SET potential_profit = kl.market_avg - l.price - $1
       FROM listings l
       WHERE kl.listing_id = l.id
         AND kl.keyword_id = $2
         AND kl.market_avg IS NOT NULL
         AND l.price IS NOT NULL`,
      [parseFloat(String(updated.shipping_estimate)) || 4, id],
    );
    return updated;
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.repo.delete(id);
  }
}

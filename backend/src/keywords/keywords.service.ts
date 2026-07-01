import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Keyword } from './keyword.entity';
import { CreateKeywordDto } from './dto/create-keyword.dto';

@Injectable()
export class KeywordsService {
  constructor(
    @InjectRepository(Keyword)
    private readonly repo: Repository<Keyword>,
  ) {}

  findAll(userId?: number): Promise<Keyword[]> {
    return this.repo.find({
      where: userId ? { user_id: userId } : {},
      order: { created_at: 'DESC' },
    });
  }

  findActive(): Promise<Keyword[]> {
    return this.repo.find({
      where: { active: true },
      relations: ['user'],
      order: { id: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Keyword> {
    const kw = await this.repo.findOneBy({ id });
    if (!kw) throw new NotFoundException(`Keyword ${id} not found`);
    return kw;
  }

  async create(dto: CreateKeywordDto): Promise<Keyword> {
    this.validateSearchCriteria(dto);
    const kw = this.repo.create({ ...dto, search_text: dto.search_text ?? '' });
    return this.repo.save(kw);
  }

  async update(id: number, dto: Partial<CreateKeywordDto>): Promise<Keyword> {
    await this.findOne(id);
    this.validateSearchCriteria(dto);
    await this.repo.update(id, {
      ...dto,
      search_text: dto.search_text ?? '',
      updated_at: new Date(),
    });
    return this.findOne(id);
  }

  /** Il faut au moins un texte de recherche ou une catégorie Vinted pour scanner. */
  private validateSearchCriteria(dto: Partial<CreateKeywordDto>): void {
    if (!dto.search_text?.trim() && !dto.catalog_id) {
      throw new BadRequestException(
        'Renseignez un texte de recherche ou un ID de catégorie Vinted.',
      );
    }
  }

  async remove(id: number): Promise<void> {
    await this.findOne(id);
    await this.repo.delete(id);
  }
}

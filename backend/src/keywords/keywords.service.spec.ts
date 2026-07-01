import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Keyword } from './keyword.entity';
import { KeywordsService } from './keywords.service';

function mockRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((entity: any) => Promise.resolve({ id: 1, ...entity })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
}

async function buildService(
  repoOverrides: Partial<Record<string, jest.Mock>> = {},
) {
  const repo = mockRepo(repoOverrides);
  const moduleRef = await Test.createTestingModule({
    providers: [
      KeywordsService,
      { provide: getRepositoryToken(Keyword), useValue: repo },
    ],
  }).compile();
  return { service: moduleRef.get(KeywordsService), repo };
}

describe('KeywordsService', () => {
  it('findAll with no userId fetches all keywords', async () => {
    const { service, repo } = await buildService();
    await service.findAll();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('findAll with userId filters by owner', async () => {
    const { service, repo } = await buildService();
    await service.findAll(3);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 3 } }),
    );
  });

  it('findActive loads the user relation and stays unfiltered', async () => {
    const { service, repo } = await buildService();
    await service.findActive();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, relations: ['user'] }),
    );
  });

  it('create rejects a keyword with neither search_text nor catalog_id', async () => {
    const { service } = await buildService();
    await expect(
      service.create({ user_id: 1, label: 'CPU' } as any),
    ).rejects.toThrow(
      'Renseignez un texte de recherche ou un ID de catégorie Vinted.',
    );
  });

  it('create accepts a category-only keyword and defaults search_text to empty string', async () => {
    const { service, repo } = await buildService();
    await service.create({ user_id: 1, label: 'CPU', catalog_id: 3599 });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ search_text: '' }),
    );
  });

  it('update rejects clearing both search_text and catalog_id', async () => {
    const { service, repo } = await buildService({
      findOneBy: jest.fn().mockResolvedValue({ id: 1, label: 'CPU' }),
    });
    await expect(service.update(1, { label: 'CPU' } as any)).rejects.toThrow(
      'Renseignez un texte de recherche ou un ID de catégorie Vinted.',
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});

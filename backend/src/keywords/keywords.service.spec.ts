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

async function buildService(repoOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const repo = mockRepo(repoOverrides);
  const moduleRef = await Test.createTestingModule({
    providers: [KeywordsService, { provide: getRepositoryToken(Keyword), useValue: repo }],
  }).compile();
  return { service: moduleRef.get(KeywordsService), repo };
}

describe('KeywordsService', () => {
  it('findAll with no userId fetches all keywords', async () => {
    const { service, repo } = await buildService();
    await service.findAll();
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('findAll with userId filters by owner', async () => {
    const { service, repo } = await buildService();
    await service.findAll(3);
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: 3 } }));
  });

  it('findActive loads the user relation and stays unfiltered', async () => {
    const { service, repo } = await buildService();
    await service.findActive();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true }, relations: ['user'] }),
    );
  });
});

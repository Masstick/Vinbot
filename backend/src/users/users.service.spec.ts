import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

function mockRepo<T>(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((entity: any) => Promise.resolve({ id: 1, ...entity })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    ...overrides,
  };
}

async function buildService(repoOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const repo = mockRepo(repoOverrides);
  const moduleRef = await Test.createTestingModule({
    providers: [UsersService, { provide: getRepositoryToken(User), useValue: repo }],
  }).compile();
  return { service: moduleRef.get(UsersService), repo };
}

describe('UsersService', () => {
  it('findAll returns all users', async () => {
    const users = [{ id: 1, name: 'Principal', telegram_chat_id: '-100', created_at: new Date() }];
    const { service } = await buildService({ find: jest.fn().mockResolvedValue(users) });
    await expect(service.findAll()).resolves.toEqual(users);
  });

  it('create persists a new user', async () => {
    const { service, repo } = await buildService();
    const result = await service.create({ name: 'Alice', telegram_chat_id: '-200' } as any);
    expect(repo.save).toHaveBeenCalled();
    expect(result).toMatchObject({ name: 'Alice', telegram_chat_id: '-200' });
  });

  it('remove deletes a user by id', async () => {
    const { service, repo } = await buildService();
    await service.remove(5);
    expect(repo.delete).toHaveBeenCalledWith(5);
  });
});

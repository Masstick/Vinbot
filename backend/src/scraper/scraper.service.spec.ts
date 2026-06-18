// Deps ESM-only tirées via vinted.client — sans intérêt pour le pause/resume.
jest.mock('axios-cookiejar-support', () => ({ wrapper: (c: any) => c }));
jest.mock('tough-cookie', () => ({ CookieJar: class {} }));
jest.mock('axios', () => ({ create: () => ({}) }));

import { ScraperService } from './scraper.service';

/**
 * Couvre le contrôle pause/reprise persistant : setPaused doit basculer l'état
 * en mémoire ET l'écrire en base, et getStatus doit refléter ce flag.
 */
describe('ScraperService — pause/resume', () => {
  let service: ScraperService;
  let query: jest.Mock;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    const keywordsService: any = { findActive: jest.fn().mockResolvedValue([]) };
    const dataSource: any = { query };
    service = new ScraperService(
      keywordsService,
      {} as any,
      {} as any,
      {} as any,
      dataSource,
    );
  });

  it('démarre actif par défaut', () => {
    expect(service.isPaused()).toBe(false);
  });

  it('setPaused(true) met en pause et persiste en base', async () => {
    const res = await service.setPaused(true);
    expect(res).toEqual({ paused: true });
    expect(service.isPaused()).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE scraper_state SET paused'),
      [true],
    );
  });

  it('setPaused(false) relance et persiste en base', async () => {
    await service.setPaused(true);
    const res = await service.setPaused(false);
    expect(res).toEqual({ paused: false });
    expect(service.isPaused()).toBe(false);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [false]);
  });

  it('getStatus expose le flag paused', async () => {
    await service.setPaused(true);
    const status = await service.getStatus();
    expect(status.paused).toBe(true);
  });
});

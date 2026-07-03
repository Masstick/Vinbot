jest.mock('axios-cookiejar-support', () => ({ wrapper: (c: any) => c }));
jest.mock('tough-cookie', () => ({ CookieJar: class {} }));
jest.mock('axios', () => ({ create: () => ({}) }));

import { ScraperService } from './scraper.service';

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
      {} as any,
      {} as any,
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

describe('ScraperService — classification & gating des alertes', () => {
  function buildService(overrides: {
    listingsService?: any;
    telegramService?: any;
    dealsGateway?: any;
    productClassifier?: any;
    productTypeStats?: any;
  } = {}) {
    const dataSource: any = { query: jest.fn().mockResolvedValue([]) };
    const keywordsService: any = { findActive: jest.fn().mockResolvedValue([]) };
    const listingsService: any = {
      upsertListing: jest.fn(),
      setProductTypeKey: jest.fn(),
      setDealScore: jest.fn(),
      updateSellerCountry: jest.fn(),
      ...overrides.listingsService,
    };
    const telegramService: any = { sendListingAlert: jest.fn().mockResolvedValue(undefined), ...overrides.telegramService };
    const dealsGateway: any = { emitNewListing: jest.fn(), emitDealUpdated: jest.fn(), ...overrides.dealsGateway };
    const productClassifier: any = { classifyByRules: jest.fn(), classifyWithMistral: jest.fn(), ...overrides.productClassifier };
    const productTypeStats: any = { recompute: jest.fn(), ...overrides.productTypeStats };
    const service = new ScraperService(
      keywordsService, listingsService, telegramService, dealsGateway, dataSource, productClassifier, productTypeStats,
    );
    return { service, listingsService, telegramService, dealsGateway, productClassifier, productTypeStats };
  }

  const categoryKeyword = { id: 7, label: 'Piece info', search_text: '', min_price: null, max_price: null, catalog_id: 3025, country_codes: ['fr'], user_id: 1 };
  const textKeyword = { id: 4, label: 'Ddr4', search_text: 'Ddr4 3200 8gb', min_price: null, max_price: null, catalog_id: null, country_codes: ['fr'], user_id: 1 };
  const item = { vinted_id: 1, title: '16GB DDR4 Kingston', price: 20, url: 'https://vinted.fr/x', photo_url: null, brand: 'Kingston', size_label: null, condition_label: null, seller_name: 's', seller_id: 9, catalog_id: 3025, vinted_created_at: null };
  const listing = { id: 42, title: item.title, price: item.price, url: item.url, photo_url: null, vinted_created_at: null };

  it("alerte inconditionnellement sur un mot-clé avec texte de recherche (comportement inchangé)", async () => {
    const { service, telegramService, productClassifier } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
    });
    await (service as any).scanAndProcess(textKeyword, [item], 'fr');
    expect(productClassifier.classifyByRules).not.toHaveBeenCalled();
    expect(telegramService.sendListingAlert).toHaveBeenCalled();
  });

  it("mot-clé catégorie-seule, non classifié par les règles → pas d'alerte, avgPrice/dealScore null", async () => {
    const { service, telegramService, dealsGateway } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue(null) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).not.toHaveBeenCalled();
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: null, dealScore: null, isDeal: false }),
    );
  });

  it("mot-clé catégorie-seule, classifié mais groupe pas encore fiable (< 5) → pas d'alerte, avgPrice null", async () => {
    const { service, telegramService, dealsGateway } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue('RAM DDR4 16GB') },
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 25, itemCount: 3 }) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).not.toHaveBeenCalled();
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: null, dealScore: null, isDeal: false }),
    );
  });

  it("mot-clé catégorie-seule, fiable et deal_score sous le seuil → pas d'alerte, avgPrice renseigné", async () => {
    const { service, telegramService, dealsGateway, listingsService } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue('RAM DDR4 16GB') },
      // avg=21, prix=20 → deal_score = (21-20)/21*100 ≈ 4.76% < seuil 20%
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 21, itemCount: 6 }) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).not.toHaveBeenCalled();
    expect(listingsService.setDealScore).toHaveBeenCalledWith(7, 42, expect.any(Number));
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: 21, isDeal: false }),
    );
  });

  it("mot-clé catégorie-seule, fiable et deal_score au-dessus du seuil → alerte + isDeal true", async () => {
    const { service, telegramService, dealsGateway } = buildService({
      listingsService: { upsertListing: jest.fn().mockResolvedValue({ listing, isNew: true, priceChanged: false }) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue('RAM DDR4 16GB') },
      // avg=30, prix=20 → deal_score = (30-20)/30*100 ≈ 33% >= seuil 20%
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 30, itemCount: 6 }) },
    });
    await (service as any).scanAndProcess(categoryKeyword, [item], 'fr');
    expect(telegramService.sendListingAlert).toHaveBeenCalled();
    expect(dealsGateway.emitNewListing).toHaveBeenCalledWith(
      expect.objectContaining({ avgPrice: 30, isDeal: true }),
    );
  });
});

describe('ScraperService — sweep de classification différée (règles + Mistral)', () => {
  function buildService(overrides: { listingsService?: any; productClassifier?: any; productTypeStats?: any; dealsGateway?: any; telegramService?: any; keywordsService?: any } = {}) {
    const dataSource: any = { query: jest.fn().mockResolvedValue([]) };
    const keywordsService: any = { findActive: jest.fn().mockResolvedValue([]), findOne: jest.fn(), ...overrides.keywordsService };
    const listingsService: any = {
      getUnclassifiedListings: jest.fn().mockResolvedValue([]),
      incrementClassificationAttempts: jest.fn(),
      setProductTypeKey: jest.fn(),
      setDealScore: jest.fn(),
      getListingById: jest.fn(),
      ...overrides.listingsService,
    };
    const telegramService: any = { sendListingAlert: jest.fn().mockResolvedValue(undefined), ...overrides.telegramService };
    const dealsGateway: any = { emitDealUpdated: jest.fn(), ...overrides.dealsGateway };
    // classifyByRules retourne null par défaut : force le chemin Mistral dans les tests
    // existants qui ne le mockent pas explicitement.
    const productClassifier: any = { classifyByRules: jest.fn().mockReturnValue(null), classifyWithMistral: jest.fn(), ...overrides.productClassifier };
    const productTypeStats: any = { recompute: jest.fn(), ...overrides.productTypeStats };
    const service = new ScraperService(
      keywordsService, listingsService, telegramService, dealsGateway, dataSource, productClassifier, productTypeStats,
    );
    return { service, listingsService, telegramService, dealsGateway, productClassifier, productTypeStats, keywordsService };
  }

  const candidate = { id: 42, title: 'Scheda Madre ASUS P8H67-M', price: 25, keywordId: 7 };

  it("titre non reconnu par les règles ni par Mistral → incrémente les tentatives, pas de mise à jour de stats", async () => {
    const { service, listingsService, productClassifier } = buildService({
      listingsService: { getUnclassifiedListings: jest.fn().mockResolvedValue([candidate]) },
      productClassifier: { classifyWithMistral: jest.fn().mockResolvedValue(null) },
    });
    await (service as any).enqueueClassificationSweep();
    expect(listingsService.incrementClassificationAttempts).toHaveBeenCalledWith(42);
    expect(listingsService.setProductTypeKey).not.toHaveBeenCalled();
  });

  it("backfill : titre reconnu par les règles gratuites → classifie sans jamais appeler Mistral", async () => {
    const ramCandidate = { id: 99, title: '16GB DDR4 Kingston', price: 20, keywordId: 7 };
    const { service, listingsService, productClassifier } = buildService({
      listingsService: { getUnclassifiedListings: jest.fn().mockResolvedValue([ramCandidate]) },
      productClassifier: { classifyByRules: jest.fn().mockReturnValue('RAM DDR4 16GB') },
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 25, itemCount: 3 }) },
    });
    await (service as any).enqueueClassificationSweep();
    expect(listingsService.setProductTypeKey).toHaveBeenCalledWith(99, 'RAM DDR4 16GB');
    expect(productClassifier.classifyWithMistral).not.toHaveBeenCalled();
  });

  it("titre reconnu par Mistral, groupe pas encore fiable → deal-updated avec avgPrice/dealScore null", async () => {
    const { service, listingsService, dealsGateway } = buildService({
      listingsService: { getUnclassifiedListings: jest.fn().mockResolvedValue([candidate]) },
      productClassifier: { classifyWithMistral: jest.fn().mockResolvedValue('Carte mère ATX') },
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 30, itemCount: 2 }) },
    });
    await (service as any).enqueueClassificationSweep();
    expect(listingsService.setProductTypeKey).toHaveBeenCalledWith(42, 'Carte mère ATX');
    expect(dealsGateway.emitDealUpdated).toHaveBeenCalledWith({ listingId: 42, avgPrice: null, dealScore: null, isDeal: false });
  });

  it("titre reconnu par Mistral, groupe fiable et intéressant → alerte Telegram + deal-updated isDeal=true", async () => {
    const fullListing = { id: 42, title: candidate.title, price: 25, url: 'https://vinted.fr/x', photo_url: null, country_code: 'fr' };
    const keyword = { id: 7, label: 'Piece info', user_id: 1 };
    const { service, telegramService, dealsGateway } = buildService({
      listingsService: {
        getUnclassifiedListings: jest.fn().mockResolvedValue([candidate]),
        getListingById: jest.fn().mockResolvedValue(fullListing),
      },
      keywordsService: { findOne: jest.fn().mockResolvedValue(keyword) },
      productClassifier: { classifyWithMistral: jest.fn().mockResolvedValue('Carte mère ATX') },
      // avg=40, prix=25 → deal_score = (40-25)/40*100 = 37.5% >= seuil 20%
      productTypeStats: { recompute: jest.fn().mockResolvedValue({ avgPrice: 40, itemCount: 6 }) },
    });
    await (service as any).enqueueClassificationSweep();
    expect(telegramService.sendListingAlert).toHaveBeenCalledWith(fullListing, keyword, 'fr');
    expect(dealsGateway.emitDealUpdated).toHaveBeenCalledWith({ listingId: 42, avgPrice: 40, dealScore: 37.5, isDeal: true });
  });
});

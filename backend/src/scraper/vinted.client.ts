import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Logger } from '@nestjs/common';
import { VintedItem } from '../listings/listings.service';

const SESSION_TTL_MS = 90 * 60 * 1000; // 90 minutes

export const COUNTRY_DOMAINS: Record<string, string> = {
  fr: 'https://www.vinted.fr',
  be: 'https://www.vinted.be',
  es: 'https://www.vinted.es',
  pl: 'https://www.vinted.pl',
  de: 'https://www.vinted.de',
  nl: 'https://www.vinted.nl',
  it: 'https://www.vinted.it',
  pt: 'https://www.vinted.pt',
  se: 'https://www.vinted.se',
  cz: 'https://www.vinted.cz',
  sk: 'https://www.vinted.sk',
  hu: 'https://www.vinted.hu',
  ro: 'https://www.vinted.ro',
  at: 'https://www.vinted.at',
  lu: 'https://www.vinted.lu',
  lt: 'https://www.vinted.lt',
  lv: 'https://www.vinted.lv',
  ee: 'https://www.vinted.ee',
  uk: 'https://www.vinted.co.uk',
};

export class VintedClient {
  private readonly logger = new Logger(VintedClient.name);
  private client: ReturnType<typeof wrapper>;
  private sessionReady = false;
  private lastSessionInit: number = 0;
  private readonly baseUrl: string;
  private readonly apiUrl: string;
  readonly countryCode: string;

  constructor(countryCode: string = 'fr') {
    this.countryCode = countryCode;
    this.baseUrl = COUNTRY_DOMAINS[countryCode] ?? COUNTRY_DOMAINS['fr'];
    this.apiUrl = `${this.baseUrl}/api/v2/catalog/items`;
    this.client = this.createHttpClient();
  }

  private createHttpClient(): ReturnType<typeof wrapper> {
    const jar = new CookieJar();
    return wrapper(
      axios.create({
        jar,
        withCredentials: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      } as any),
    );
  }

  async initSession(): Promise<void> {
    const now = Date.now();
    // Force re-init if session TTL has elapsed
    if (now - this.lastSessionInit > SESSION_TTL_MS) {
      this.sessionReady = false;
    }

    if (this.sessionReady) return;

    try {
      await this.client.get(this.baseUrl, { timeout: 15000 });
      this.sessionReady = true;
      this.lastSessionInit = Date.now();
      this.logger.log(`Session Vinted initialisée [${this.countryCode}]`);
    } catch (err: any) {
      this.logger.warn(`Échec init session [${this.countryCode}]: ${err.message}`);
    }
  }

  resetSession(): void {
    this.client = this.createHttpClient();
    this.sessionReady = false;
    this.lastSessionInit = 0;
  }

  async search(
    searchText: string,
    priceFrom?: number | null,
    priceTo?: number | null,
    perPage = 96,
    page = 1,
    catalogId?: number | null,
  ): Promise<VintedItem[]> {
    await this.initSession();
    try {
      const params: any = {
        search_text: searchText,
        order: 'newest_first',
        per_page: perPage,
        page,
        currency: 'EUR',
      };
      if (priceFrom !== undefined && priceFrom !== null) {
        params.price_from = priceFrom;
      }
      if (priceTo !== undefined && priceTo !== null) {
        params.price_to = priceTo;
      }
      if (catalogId !== undefined && catalogId !== null) {
        params['catalog_ids[]'] = catalogId;
      }

      const response = await this.client.get(this.apiUrl, {
        params,
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: `${this.baseUrl}/catalog`,
        },
        timeout: 20000,
      });

      const items: any[] = response.data?.items ?? [];
      return items.map(item => this.parseItem(item)).filter(i => i.price > 0);
    } catch (err: any) {
      if (err.response?.status === 403) {
        this.logger.warn(`Vinted 403 [${this.countryCode}] — reset session`);
        this.resetSession();
        throw new Error('BANNED');
      }
      this.logger.error(`Erreur search [${this.countryCode}] "${searchText}": ${err.message}`);
      return [];
    }
  }

  private parseItem(item: any): VintedItem {
    return {
      vinted_id: item.id,
      title: item.title ?? '',
      price: parseFloat(item.price?.amount ?? '0'),
      url: item.url ?? `${this.baseUrl}/items/${item.id}`,
      photo_url: item.photo?.url ?? item.photos?.[0]?.url ?? '',
      brand: item.brand_title ?? '',
      size_label: item.size_title ?? '',
      condition_label: item.status ?? '',
      seller_name: item.user?.login ?? '',
      seller_id: item.user?.id ?? 0,
    };
  }
}

/**
 * VintedClientPool manages one VintedClient per country code.
 * Clients are created lazily on first use.
 */
export class VintedClientPool {
  private readonly pool = new Map<string, VintedClient>();

  getClient(countryCode: string): VintedClient {
    const code = countryCode.toLowerCase();
    if (!this.pool.has(code)) {
      this.pool.set(code, new VintedClient(code));
    }
    return this.pool.get(code)!;
  }

  /** Return all currently instantiated clients (useful for health checks). */
  getActiveClients(): VintedClient[] {
    return Array.from(this.pool.values());
  }
}

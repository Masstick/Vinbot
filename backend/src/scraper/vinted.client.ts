import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { Logger } from '@nestjs/common';
import { VintedItem } from '../listings/listings.service';

const VINTED_URL = 'https://www.vinted.fr';
const VINTED_API_URL = 'https://www.vinted.fr/api/v2/catalog/items';

export class VintedClient {
  private readonly logger = new Logger(VintedClient.name);
  private client: ReturnType<typeof wrapper>;
  private sessionReady = false;

  constructor() {
    const jar = new CookieJar();
    this.client = wrapper(
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
    if (this.sessionReady) return;
    try {
      await this.client.get(VINTED_URL, { timeout: 15000 });
      this.sessionReady = true;
      this.logger.log('Session Vinted initialisée');
    } catch (err: any) {
      this.logger.warn(`Échec init session: ${err.message}`);
    }
  }

  resetSession(): void {
    const jar = new CookieJar();
    this.client = wrapper(
      axios.create({
        jar,
        withCredentials: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      } as any),
    );
    this.sessionReady = false;
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

      const response = await this.client.get(VINTED_API_URL, {
        params,
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: 'https://www.vinted.fr/catalog',
        },
        timeout: 20000,
      });

      const items: any[] = response.data?.items ?? [];
      return items.map(item => this.parseItem(item)).filter(i => i.price > 0);
    } catch (err: any) {
      if (err.response?.status === 403) {
        this.logger.warn('Vinted 403 — reset session');
        this.resetSession();
        throw new Error('BANNED');
      }
      this.logger.error(`Erreur search "${searchText}": ${err.message}`);
      return [];
    }
  }

  private parseItem(item: any): VintedItem {
    return {
      vinted_id: item.id,
      title: item.title ?? '',
      price: parseFloat(item.price?.amount ?? '0'),
      url: item.url ?? `https://www.vinted.fr/items/${item.id}`,
      photo_url: item.photo?.url ?? item.photos?.[0]?.url ?? '',
      brand: item.brand_title ?? '',
      size_label: item.size_title ?? '',
      condition_label: item.status ?? '',
      seller_name: item.user?.login ?? '',
      seller_id: item.user?.id ?? 0,
    };
  }
}

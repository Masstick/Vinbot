import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { Cookie, CookieJar } from 'tough-cookie';
import { Logger } from '@nestjs/common';

const BASE = 'https://www.vinted.fr';

export type SellerStatus = 'ONLINE' | 'RESERVED' | 'SOLD' | 'DELETED';

export interface SellerItem {
  vinted_id: number;
  title: string;
  price: number;
  url: string;
  photo_url: string;
  brand: string;
  size_label: string;
  condition_label: string;
  status: SellerStatus;
  view_count: number;
  favourite_count: number;
  vinted_created_at: Date | null;
}

export interface SaleRecord {
  vinted_order_id: number;
  buyer_name: string;
  sale_price: number;
  shipping_status: string;
  sold_at: Date | null;
  vinted_item_id: number | null;
}

/** Helper pur : article Vinted brut → SellerItem. */
export function mapMemberItem(raw: any): SellerItem {
  let status: SellerStatus = 'ONLINE';
  if (raw.is_closed) status = 'SOLD';
  else if (raw.is_reserved) status = 'RESERVED';
  return {
    vinted_id: Number(raw.id),
    title: raw.title ?? '',
    price: parseFloat(raw.price?.amount ?? raw.price ?? '0') || 0,
    url: raw.url ?? `${BASE}/items/${raw.id}`,
    photo_url: raw.photo?.url ?? raw.photos?.[0]?.url ?? '',
    brand: raw.brand_title ?? '',
    size_label: raw.size_title ?? '',
    condition_label: raw.status ?? '',
    status,
    view_count: Number(raw.view_count ?? 0) || 0,
    favourite_count: Number(raw.favourite_count ?? 0) || 0,
    vinted_created_at: raw.created_at_ts != null ? new Date(Number(raw.created_at_ts) * 1000) : null,
  };
}

/** Helper pur : commande Vinted brute → SaleRecord. */
export function mapSale(raw: any): SaleRecord {
  return {
    vinted_order_id: Number(raw.id),
    buyer_name: raw.buyer?.login ?? raw.user?.login ?? '',
    sale_price: parseFloat(raw.price?.amount ?? raw.price ?? '0') || 0,
    shipping_status: raw.status ?? '',
    vinted_item_id: raw.item_id != null ? Number(raw.item_id) : null,
    sold_at: raw.updated_at ? new Date(raw.updated_at) : raw.created_at ? new Date(raw.created_at) : null,
  };
}

export class VintedSellerClient {
  private readonly logger = new Logger(VintedSellerClient.name);
  private readonly jar = new CookieJar();
  private readonly client = wrapper(
    axios.create({
      jar: this.jar,
      withCredentials: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    } as any),
  );

  constructor(sessionJson: string) {
    this.seedJar(sessionJson);
  }

  /** Réinjecte les cookies du storageState dans le jar tough-cookie. */
  private seedJar(sessionJson: string): void {
    const state = JSON.parse(sessionJson);
    for (const c of state.cookies ?? []) {
      const cookie = new Cookie({
        key: c.name,
        value: c.value,
        domain: (c.domain ?? '.vinted.fr').replace(/^\./, ''),
        path: c.path ?? '/',
        secure: c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
      });
      try {
        this.jar.setCookieSync(cookie.toString(), BASE);
      } catch {
        /* cookie hors-domaine ignoré */
      }
    }
  }

  /** Exporte l'état courant du jar au format storageState JSON (cookies à jour). */
  private exportSessionJson(): string {
    const cookies = this.jar.getCookiesSync(BASE).map((c) => ({
      name: c.key, value: c.value, domain: c.domain ? `.${c.domain}` : '.vinted.fr',
      path: c.path ?? '/', secure: true, httpOnly: !!c.httpOnly,
    }));
    return JSON.stringify({ cookies, origins: [] });
  }

  private throwIfUnauthorized(status?: number): void {
    if (status === 401 || status === 403) {
      throw new Error('SESSION_EXPIRED');
    }
  }

  async getMemberItems(userId: number, page = 1): Promise<SellerItem[]> {
    try {
      const resp = await this.client.get(`${BASE}/api/v2/users/${userId}/items`, {
        params: { per_page: 96, page },
        headers: { Referer: `${BASE}/member/${userId}` },
        timeout: 20000,
      });
      const items: any[] = resp.data?.items ?? [];
      return items.map(mapMemberItem);
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      this.logger.warn(`getMemberItems échec: ${err.message}`);
      return [];
    }
  }

  async getSales(): Promise<SaleRecord[]> {
    try {
      const resp = await this.client.get(`${BASE}/api/v2/my_orders`, {
        params: { type: 'sold', page: 1, per_page: 50 },
        headers: { Referer: `${BASE}/member/items/sold` },
        timeout: 20000,
      });
      const orders: any[] = resp.data?.my_orders ?? resp.data?.orders ?? [];
      return orders.map(mapSale);
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      this.logger.warn(`getSales échec: ${err.message}`);
      return [];
    }
  }

  /** Keep-alive : touche le site, renvoie le storageState à jour (cookies rotés). */
  async keepAlive(): Promise<string> {
    try {
      await this.client.get(`${BASE}/api/v2/users/current`, { timeout: 15000 });
      return this.exportSessionJson();
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      // Sur erreur non-401/403 (timeout, 5xx, réseau), on renvoie l'erreur originale
      // (la rotation de session a échoué), contrairement à getMemberItems/getSales qui retournent [].
      throw err;
    }
  }
}

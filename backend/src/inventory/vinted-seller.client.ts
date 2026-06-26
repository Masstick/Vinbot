import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { Cookie, CookieJar } from 'tough-cookie';
import { Logger } from '@nestjs/common';

const BASE = 'https://www.vinted.fr';

export const MEMBER_ITEMS_PER_PAGE = 96;
export const SALES_PER_PAGE = 50;

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
  catalog_id: number | null;
  category: string | null;
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
    catalog_id: raw.catalog_id != null ? Number(raw.catalog_id) : null,
    category: null, // libellé résolu plus tard via la map de catalogues (le sync le remplit)
  };
}

/** Helper pur : aplatit récursivement l'arbre de catalogues Vinted en {id, title}. */
export function flattenCatalogs(raw: any): Array<{ id: number; title: string }> {
  const out: Array<{ id: number; title: string }> = [];
  const walk = (nodes: any[]) => {
    for (const n of nodes ?? []) {
      if (n && n.id != null) out.push({ id: Number(n.id), title: n.title ?? '' });
      if (Array.isArray(n?.catalogs)) walk(n.catalogs);
    }
  };
  walk(raw?.catalogs ?? raw ?? []);
  return out;
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

  /** Récupère les articles d'un vendeur (pagés). Lance une erreur en cas d'échec non-authentification. */
  async getMemberItems(userId: number, page = 1): Promise<SellerItem[]> {
    try {
      const resp = await this.client.get(`${BASE}/api/v2/users/${userId}/items`, {
        params: { per_page: MEMBER_ITEMS_PER_PAGE, page },
        headers: { Referer: `${BASE}/member/${userId}` },
        timeout: 20000,
      });
      const items: any[] = resp.data?.items ?? [];
      return items.map(mapMemberItem);
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      throw err;
    }
  }

  /** Récupère les ventes du compte (pagées). Lance une erreur en cas d'échec non-authentification. */
  async getSales(page = 1): Promise<SaleRecord[]> {
    try {
      const resp = await this.client.get(`${BASE}/api/v2/my_orders`, {
        params: { type: 'sold', page, per_page: SALES_PER_PAGE },
        headers: { Referer: `${BASE}/member/items/sold` },
        timeout: 20000,
      });
      const orders: any[] = resp.data?.my_orders ?? resp.data?.orders ?? [];
      return orders.map(mapSale);
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      throw err;
    }
  }

  /** Récupère l'arbre de catégories Vinted, aplati en map catalog_id → libellé. */
  async getCatalogMap(): Promise<Map<number, string>> {
    try {
      const resp = await this.client.get(`${BASE}/api/v2/catalogs`, {
        headers: { Referer: `${BASE}/` },
        timeout: 20000,
      });
      const map = new Map<number, string>();
      for (const c of flattenCatalogs(resp.data)) map.set(c.id, c.title);
      return map;
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      this.logger.warn(`getCatalogMap échec: ${err.message}`);
      return new Map();
    }
  }

  /**
   * Sonde de vivacité : envoie une requête légère pour maintenir la session active et
   * récupère les cookies éventuellement rotatés par le serveur (re-export du jar à jour).
   * Ce n'est PAS un vrai rafraîchissement de token — la session peut toujours expirer
   * entre deux appels. Un endpoint dédié de renouvellement de token est prévu (Bloc B).
   */
  async keepAlive(): Promise<string> {
    try {
      await this.client.get(`${BASE}/api/v2/users/current`, { timeout: 15000 });
      return this.exportSessionJson();
    } catch (err: any) {
      this.throwIfUnauthorized(err.response?.status);
      // Sur erreur non-401/403 (timeout, 5xx, réseau), on relance l'erreur originale
      // (la rotation de session a échoué) ; getMemberItems/getSales relancent aussi.
      throw err;
    }
  }
}

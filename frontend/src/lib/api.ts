const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface Keyword {
  id: number;
  label: string;
  search_text: string;
  min_price: number | null;
  max_price: number | null;
  category: string | null;
  catalog_id: number | null;
  scan_interval_seconds: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  /** ISO country codes to scan, e.g. ["fr", "be", "es"] */
  country_codes?: string[];
  user_id: number;
}

export interface User {
  id: number;
  name: string;
  telegram_chat_id: string;
  created_at: string;
}

export interface AccountStatusResp {
  connected: boolean;
  status: 'connected' | 'expired' | 'disconnected' | 'none';
  label?: string;
  vinted_user_id?: number;
  connected_at?: string;
}

export interface InventoryRow {
  id: number;
  product_id: number | null;
  vinted_id: number;
  url: string | null;
  price: number | null;
  status: 'ONLINE' | 'RESERVED' | 'SOLD' | 'DELETED';
  view_count: number | null;
  favourite_count: number | null;
  photo_url: string | null;
  vinted_created_at: string | null;
  last_synced_at: string | null;
  title: string | null;
  brand: string | null;
  size_label: string | null;
  category: string | null;
  purchase_price: number | null;
  margin: number | null;
}

export interface SaleRow {
  id: number;
  account_id: number;
  seller_listing_id: number | null;
  vinted_order_id: number | null;
  buyer_name: string | null;
  sale_price: number | null;
  shipping_status: string | null;
  sold_at: string | null;
}

export interface InventoryFilterParams {
  brand?: string; size?: string; category?: string; priceMin?: number; priceMax?: number;
}

export interface Listing {
  id: number;
  vinted_id: number;
  title: string | null;
  price: number | null;
  url: string | null;
  photo_url: string | null;
  brand: string | null;
  size_label: string | null;
  condition_label: string | null;
  seller_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
  /** Real Vinted publication date (from API created_at_ts). Null for listings scraped before this feature. */
  vinted_created_at?: string | null;
  /** Derived server-side or computed client-side from first_seen_at */
  freshness_hours?: number;
  /** ISO code of the scraped marketplace domain, e.g. "fr", "be", "es" */
  country_code?: string;
  /** Real ISO country of the seller (from their Vinted profile). Preferred over country_code. */
  seller_country?: string;
}

export interface KeywordListing {
  keyword_id: number;
  listing_id: number;
  matched_at: string;
  keyword: Keyword;
  listing: Listing;
}

export interface PricePoint {
  id: number;
  price: number;
  recorded_at: string;
}

export interface Stats {
  total_listings: number;
  active_keywords: number;
  alerts_24h: number;
  listings_24h: number;
}

export interface LatestListingsParams {
  keywordId?: number;
  limit?: number;
  offset?: number;
  country?: string;
  q?: string;
  maxAgeHours?: number;
  soloSeller?: boolean;
  userId?: number;
}

/**
 * L'endpoint SQL brut /listings renvoie des lignes plates (l.* + kl.* + k.*) —
 * on les remet en forme KeywordListing pour réutiliser DealCard partout.
 */
function rowToKeywordListing(row: any): KeywordListing {
  const listingId = row.listing_id ?? row.id;
  return {
    keyword_id: row.keyword_id,
    listing_id: listingId,
    matched_at: row.matched_at,
    keyword: { id: row.keyword_id, label: row.keyword_label } as Keyword,
    listing: {
      id: listingId,
      vinted_id: row.vinted_id,
      title: row.title ?? null,
      price: row.price ?? null,
      url: row.url ?? null,
      photo_url: row.photo_url ?? null,
      brand: row.brand ?? null,
      size_label: row.size_label ?? null,
      condition_label: row.condition_label ?? null,
      seller_name: row.seller_name ?? null,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at ?? row.first_seen_at,
      freshness_hours: row.freshness_hours != null ? parseFloat(String(row.freshness_hours)) : undefined,
      country_code: row.country_code ?? undefined,
      seller_country: row.seller_country ?? undefined,
    },
  };
}

function latestQuery(p: LatestListingsParams): string {
  const qs = new URLSearchParams();
  if (p.keywordId) qs.set('keyword_id', String(p.keywordId));
  if (p.limit) qs.set('limit', String(p.limit));
  if (p.offset) qs.set('offset', String(p.offset));
  if (p.country) qs.set('country', p.country);
  if (p.q) qs.set('q', p.q);
  if (p.maxAgeHours) qs.set('max_age_hours', String(p.maxAgeHours));
  if (p.soloSeller) qs.set('solo_seller', '1');
  if (p.userId) qs.set('user_id', String(p.userId));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

function inventoryQuery(p: InventoryFilterParams): string {
  const qs = new URLSearchParams();
  if (p.brand) qs.set('brand', p.brand);
  if (p.size) qs.set('size', p.size);
  if (p.category) qs.set('category', p.category);
  if (p.priceMin != null) qs.set('price_min', String(p.priceMin));
  if (p.priceMax != null) qs.set('price_max', String(p.priceMax));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const api = {
  keywords: {
    list: (userId?: number) => req<Keyword[]>(`/keywords${userId ? `?user_id=${userId}` : ''}`),
    get: (id: number) => req<Keyword>(`/keywords/${id}`),
    create: (data: Partial<Keyword>) => req<Keyword>('/keywords', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Keyword>) => req<Keyword>(`/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => req<void>(`/keywords/${id}`, { method: 'DELETE' }),
  },
  listings: {
    latest: (params: LatestListingsParams = {}) =>
      req<any[]>(`/listings${latestQuery(params)}`).then(rows => rows.map(rowToKeywordListing)),
    get: (id: number) => req<any>(`/listings/${id}`),
    history: (id: number) => req<PricePoint[]>(`/listings/${id}/history`),
    stats: (userId?: number) => req<Stats>(`/listings/stats${userId ? `?user_id=${userId}` : ''}`),
  },
  telegram: {
    test: (chatId: string) => req<{ ok: boolean; error?: string }>('/telegram/test', { method: 'POST', body: JSON.stringify({ chat_id: chatId }) }),
  },
  scraper: {
    status: () => req<any>('/scraper/status'),
    pause: () => req<{ paused: boolean }>('/scraper/pause', { method: 'POST' }),
    resume: () => req<{ paused: boolean }>('/scraper/resume', { method: 'POST' }),
  },
  users: {
    list: () => req<User[]>('/users'),
    get: (id: number) => req<User>(`/users/${id}`),
    create: (data: Partial<User>) => req<User>('/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<User>) => req<User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => req<void>(`/users/${id}`, { method: 'DELETE' }),
  },
  accounts: {
    status: () => req<AccountStatusResp>('/accounts/status'),
    connectStart: () => req<{ novncReady: boolean }>('/accounts/connect/start', { method: 'POST' }),
    connectPoll: () => req<{ connected: boolean; vintedUserId?: number }>('/accounts/connect/poll', { method: 'POST' }),
  },
  inventory: {
    list: (filters: InventoryFilterParams = {}) => req<InventoryRow[]>(`/inventory${inventoryQuery(filters)}`),
    sales: () => req<SaleRow[]>('/inventory/sales'),
    setPurchasePrice: (productId: number, price: number | null) =>
      req<void>(`/inventory/products/${productId}/purchase-price`, { method: 'PATCH', body: JSON.stringify({ purchase_price: price }) }),
    sync: () => req<{ items?: number; sales?: number; skipped?: string }>('/inventory/sync', { method: 'POST' }),
  },
};

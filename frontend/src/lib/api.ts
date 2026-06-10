const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export interface Keyword {
  id: number;
  label: string;
  search_text: string;
  min_price: number | null;
  max_price: number | null;
  target_margin: number;
  shipping_estimate: number;
  category: string | null;
  catalog_id: number | null;
  scan_interval_seconds: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  /** ISO country codes to scan, e.g. ["fr", "be", "es"] */
  country_codes?: string[];
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
  /** ISO country code of the seller's country, e.g. "fr", "be", "es" */
  country_code?: string;
  /** Short reasoning text from AI deal analysis (deal_analyses join) */
  reasoning?: string;
}

export interface KeywordListing {
  keyword_id: number;
  listing_id: number;
  deal_score: number | null;
  market_avg: number | null;
  potential_profit: number | null;
  matched_at: string;
  keyword: Keyword;
  listing: Listing;
  /** Confidence score from AI analysis (0–1) */
  analysis_confidence?: number;
  /** AI recommendation: "buy" | "watch" | "skip" */
  recommendation?: string;
  /** AI scam risk assessment: "low" | "medium" | "high" */
  scam_risk?: string;
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
  validated_deals: number;
  listings_24h: number;
}

export interface LatestListingsParams {
  keywordId?: number;
  limit?: number;
  offset?: number;
  country?: string;
  q?: string;
  maxAgeHours?: number;
}

/**
 * Les endpoints SQL bruts (/listings, /listings/validated) renvoient des lignes
 * plates (l.* + kl.* + k.* + da.*) — on les remet en forme KeywordListing
 * pour réutiliser DealCard partout.
 */
function rowToKeywordListing(row: any): KeywordListing {
  const listingId = row.listing_id ?? row.id;
  return {
    keyword_id: row.keyword_id,
    listing_id: listingId,
    deal_score: row.deal_score,
    market_avg: row.market_avg,
    potential_profit: row.potential_profit,
    matched_at: row.matched_at,
    analysis_confidence: row.analysis_confidence ?? undefined,
    recommendation: row.recommendation ?? undefined,
    scam_risk: row.scam_risk ?? undefined,
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
      reasoning: row.reasoning ?? undefined,
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
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const api = {
  keywords: {
    list: () => req<Keyword[]>('/keywords'),
    get: (id: number) => req<Keyword>(`/keywords/${id}`),
    create: (data: Partial<Keyword>) => req<Keyword>('/keywords', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Keyword>) => req<Keyword>(`/keywords/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => req<void>(`/keywords/${id}`, { method: 'DELETE' }),
  },
  listings: {
    latest: (params: LatestListingsParams = {}) =>
      req<any[]>(`/listings${latestQuery(params)}`).then(rows => rows.map(rowToKeywordListing)),
    opportunities: (keywordId?: number) => req<KeywordListing[]>(`/listings/opportunities${keywordId ? `?keyword_id=${keywordId}` : ''}`),
    validated: () => req<any[]>('/listings/validated').then(rows => rows.map(rowToKeywordListing)),
    get: (id: number) => req<any>(`/listings/${id}`),
    history: (id: number) => req<PricePoint[]>(`/listings/${id}/history`),
    stats: () => req<Stats>('/listings/stats'),
  },
  telegram: {
    test: () => req<{ ok: boolean; error?: string }>('/telegram/test', { method: 'POST' }),
  },
  scraper: {
    status: () => req<any>('/scraper/status'),
  },
  mistral: {
    test: () => req<{ ok: boolean; error?: string }>('/mistral/test', { method: 'POST' }),
  },
};

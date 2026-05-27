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
  id: number; label: string; search_text: string;
  min_price: number | null; max_price: number | null;
  target_margin: number; shipping_estimate: number;
  category: string | null; catalog_id: number | null;
  scan_interval_seconds: number; market_scan_pages: number;
  active: boolean; created_at: string; updated_at: string;
}

export interface Listing {
  id: number; vinted_id: number; title: string | null;
  price: number | null; url: string | null; photo_url: string | null;
  brand: string | null; size_label: string | null;
  condition_label: string | null; seller_name: string | null;
  first_seen_at: string; last_seen_at: string;
  model_label?: string | null; model_confidence?: number | null;
}

export interface DealAnalysis {
  id: number; scam_risk: 'low' | 'medium' | 'high';
  confidence: number | null; recommendation: 'buy' | 'watch' | 'skip';
  reasoning: string | null; analyzed_at: string;
}

export interface KeywordListing {
  keyword_id: number; listing_id: number;
  deal_score: number | null; market_avg: number | null;
  model_market_avg?: number | null; potential_profit: number | null;
  matched_at: string; keyword: Keyword; listing: Listing;
  analysis?: DealAnalysis | null;
}

export interface ValidatedDeal {
  keyword_id: number; listing_id: number; id: number;
  deal_score: number | null; market_avg: number | null;
  model_market_avg: number | null; potential_profit: number | null;
  matched_at: string; title: string | null; price: number | null;
  url: string | null; photo_url: string | null; brand: string | null;
  condition_label: string | null; size_label: string | null;
  seller_name: string | null; first_seen_at: string;
  model_label: string | null; model_confidence: number | null;
  keyword_label: string; scam_risk: 'low' | 'medium' | 'high';
  analysis_confidence: number | null; recommendation: 'buy' | 'watch' | 'skip';
  reasoning: string | null; analyzed_at: string;
}

export interface PricePoint { id: number; price: number; recorded_at: string; }

export interface Stats {
  total_listings: number; active_keywords: number;
  alerts_24h: number; validated_deals: number;
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
    list: (keywordId?: number) => req<KeywordListing[]>(`/listings${keywordId ? `?keyword_id=${keywordId}` : ''}`),
    opportunities: (keywordId?: number) => req<KeywordListing[]>(`/listings/opportunities${keywordId ? `?keyword_id=${keywordId}` : ''}`),
    validated: (limit = 50) => req<ValidatedDeal[]>(`/listings/validated?limit=${limit}`),
    get: (id: number) => req<any>(`/listings/${id}`),
    history: (id: number) => req<PricePoint[]>(`/listings/${id}/history`),
    stats: () => req<Stats>('/listings/stats'),
  },
  telegram: {
    test: () => req<{ ok: boolean; error?: string }>('/telegram/test', { method: 'POST' }),
  },
  mistral: {
    test: () => req<{ ok: boolean; error?: string }>('/mistral/test', { method: 'POST' }),
  },
  scraper: {
    status: () => req<any>('/scraper/status'),
  },
};

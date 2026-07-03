'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, KeywordListing, Keyword, Listing } from '@/lib/api';
import { DealCard } from '@/components/DealCard';
import { Newspaper, Filter, Search, Clock, Globe, RefreshCw, ChevronDown, UserCheck } from 'lucide-react';
import { useKeywordChanged } from '@/lib/useKeywordChanged';
import { useRefreshSignal } from '@/lib/refreshEvent';
import { useListingsSocket } from '@/lib/useListingsSocket';
import { ListingEvent, DealUpdatedEvent } from '@/lib/listingEvent';
import { useCurrentUser } from '@/lib/CurrentUserContext';

const PAGE_SIZE = 48;
const FILTERS_KEY = 'vinbot_listings_filters';
const LIVE_BADGE_MS = 60_000; // durée d'affichage du badge LIVE sur une annonce poussée

interface StoredFilters {
  selectedKw?: number;
  country?: string;
  search?: string;
  maxAgeHours?: number;
  soloSeller?: boolean;
  onlyDeals?: boolean;
}

function loadStoredFilters(): StoredFilters {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(FILTERS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** Convertit un événement WebSocket en KeywordListing pour réutiliser DealCard. */
function eventToKeywordListing(ev: ListingEvent): KeywordListing {
  const now = new Date().toISOString();
  return {
    keyword_id: -1,
    listing_id: ev.listingId,
    matched_at: now,
    keyword: { label: ev.keywordLabel } as Keyword,
    listing: {
      id: ev.listingId,
      vinted_id: 0,
      title: ev.title,
      price: ev.price,
      url: ev.url,
      photo_url: ev.photoUrl,
      brand: null,
      size_label: null,
      condition_label: null,
      seller_name: null,
      first_seen_at: now,
      last_seen_at: now,
      vinted_created_at: ev.vintedCreatedAt,
      avg_price: ev.avgPrice,
      deal_score: ev.dealScore,
      is_deal: ev.isDeal,
    } as Listing,
  };
}

const COUNTRY_LABELS: Record<string, string> = {
  fr: '🇫🇷 France', be: '🇧🇪 Belgique', es: '🇪🇸 Espagne', pl: '🇵🇱 Pologne',
  de: '🇩🇪 Allemagne', nl: '🇳🇱 Pays-Bas', it: '🇮🇹 Italie', pt: '🇵🇹 Portugal',
  se: '🇸🇪 Suède', cz: '🇨🇿 Tchéquie', sk: '🇸🇰 Slovaquie', hu: '🇭🇺 Hongrie',
  ro: '🇷🇴 Roumanie', at: '🇦🇹 Autriche', lu: '🇱🇺 Luxembourg', lt: '🇱🇹 Lituanie',
  lv: '🇱🇻 Lettonie', ee: '🇪🇪 Estonie', uk: '🇬🇧 Royaume-Uni',
};

function SkeletonCard() {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl overflow-hidden h-[340px] flex flex-col justify-between p-4 animate-pulse">
      <div className="w-full h-40 bg-zinc-800/50 rounded-xl mb-4" />
      <div className="space-y-3 flex-1">
        <div className="h-4 bg-zinc-800/60 rounded-md w-3/4" />
        <div className="h-6 bg-zinc-800/60 rounded-md w-1/3" />
        <div className="h-4 bg-zinc-800/40 rounded-md w-1/2" />
      </div>
      <div className="flex gap-2 mt-4">
        <div className="h-8 bg-zinc-800/50 rounded-lg flex-1" />
        <div className="h-8 bg-zinc-800/50 rounded-lg w-10" />
      </div>
    </div>
  );
}

export default function LatestListingsPage() {
  const [items, setItems] = useState<KeywordListing[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const initialFilters = useRef(loadStoredFilters());
  const [selectedKw, setSelectedKw] = useState<number | undefined>(initialFilters.current.selectedKw);
  const [country, setCountry] = useState<string>(initialFilters.current.country ?? '');
  const [search, setSearch] = useState(initialFilters.current.search ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(initialFilters.current.search ?? '');
  const [maxAgeHours, setMaxAgeHours] = useState<number | undefined>(initialFilters.current.maxAgeHours);
  const [soloSeller, setSoloSeller] = useState(initialFilters.current.soloSeller ?? false);
  const [onlyDeals, setOnlyDeals] = useState(initialFilters.current.onlyDeals ?? false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [liveIds, setLiveIds] = useState<Set<number>>(new Set());
  const [connected, setConnected] = useState(false);
  const offsetRef = useRef(0);
  const loadTickRef = useRef(0);
  const { activeUserId } = useCurrentUser();

  const activeFilterCount =
    [selectedKw != null, !!country, !!search, maxAgeHours != null, soloSeller, onlyDeals].filter(Boolean).length;

  useEffect(() => {
    if (activeUserId == null) {
      setKeywords([]);
      return;
    }
    api.keywords.list(activeUserId).then(setKeywords).catch(() => {});
  }, [activeUserId]);

  // Debounce de la recherche texte (requête serveur)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Persiste les filtres (survit au reload / à la navigation)
  useEffect(() => {
    const filters: StoredFilters = { selectedKw, country, search, maxAgeHours, soloSeller, onlyDeals };
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  }, [selectedKw, country, search, maxAgeHours, soloSeller, onlyDeals]);

  const baseParams = useCallback(() => ({
    keywordId: selectedKw,
    country: country || undefined,
    q: debouncedSearch || undefined,
    maxAgeHours,
    soloSeller: soloSeller || undefined,
    onlyDeals: onlyDeals || undefined,
    userId: activeUserId ?? undefined,
    limit: PAGE_SIZE,
  }), [selectedKw, country, debouncedSearch, maxAgeHours, soloSeller, onlyDeals, activeUserId]);

  const load = useCallback((showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    const ticket = ++loadTickRef.current;
    api.listings.latest({ ...baseParams(), offset: 0 })
      .then(rows => {
        if (ticket !== loadTickRef.current) return;
        offsetRef.current = rows.length;
        setItems(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => { if (ticket === loadTickRef.current) setItems([]); })
      .finally(() => { if (ticket === loadTickRef.current) setLoading(false); });
  }, [baseParams]);

  // Chargement initial + à chaque changement de filtre
  useEffect(() => {
    load(true);
  }, [load]);

  // Auto-refresh de la première page toutes les 30s (tant qu'on n'a pas paginé)
  useEffect(() => {
    const interval = setInterval(() => {
      if (offsetRef.current <= PAGE_SIZE) load(false);
    }, 30000);
    return () => clearInterval(interval);
  }, [load]);

  useKeywordChanged(() => load(false));
  useRefreshSignal(() => load(true));

  // ── Temps réel : on injecte en tête les nouvelles annonces poussées par le WS ──
  const matchesFilters = useCallback((ev: ListingEvent): boolean => {
    if (activeUserId != null && ev.userId !== activeUserId) return false;
    // Pays et vendeur unique ne sont pas déductibles de l'event → on n'injecte pas en live dans ce cas
    if (country || soloSeller) return false;
    if (onlyDeals && !ev.isDeal) return false;
    if (selectedKw != null) {
      const kw = keywords.find(k => k.id === selectedKw);
      if (kw && kw.label !== ev.keywordLabel) return false;
    }
    if (debouncedSearch && !(ev.title ?? '').toLowerCase().includes(debouncedSearch.toLowerCase())) return false;
    if (maxAgeHours != null) {
      const ref = ev.vintedCreatedAt ?? new Date().toISOString();
      const ageH = (Date.now() - new Date(ref).getTime()) / 3_600_000;
      if (ageH > maxAgeHours) return false;
    }
    return true;
  }, [activeUserId, country, soloSeller, onlyDeals, selectedKw, keywords, debouncedSearch, maxAgeHours]);

  const handleNewListing = useCallback((ev: ListingEvent) => {
    if (!matchesFilters(ev)) return;
    setItems(prev => {
      if (prev.some(p => p.listing.id === ev.listingId)) return prev;
      return [eventToKeywordListing(ev), ...prev];
    });
    setLiveIds(prev => {
      const next = new Set(prev);
      next.add(ev.listingId);
      return next;
    });
    window.setTimeout(() => {
      setLiveIds(prev => {
        const next = new Set(prev);
        next.delete(ev.listingId);
        return next;
      });
    }, LIVE_BADGE_MS);
  }, [matchesFilters]);

  const handleDealUpdated = useCallback((update: DealUpdatedEvent) => {
    setItems(prev => prev.map(kl =>
      kl.listing.id === update.listingId
        ? { ...kl, listing: { ...kl.listing, avg_price: update.avgPrice, deal_score: update.dealScore, is_deal: update.isDeal } }
        : kl,
    ));
  }, []);

  const socketRef = useListingsSocket(handleNewListing, handleDealUpdated);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socketRef]);

  const loadMore = () => {
    setLoadingMore(true);
    api.listings.latest({ ...baseParams(), offset: offsetRef.current })
      .then(rows => {
        offsetRef.current += rows.length;
        setItems(prev => {
          const seen = new Set(prev.map(kl => kl.listing.id));
          return [...prev, ...rows.filter(kl => !seen.has(kl.listing.id))];
        });
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Page Title */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2">
            <Newspaper className="text-indigo-400 shrink-0" size={24} />
            Dernières annonces
          </h1>
          <p className="hidden sm:block text-sm text-zinc-400 mt-1">
            Annonces détectées en temps réel, des plus récentes aux plus anciennes.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Live status */}
          <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800">
            <span className="relative flex h-2 w-2">
              {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            </span>
            <span className={connected ? 'text-emerald-400' : 'text-zinc-500'}>{connected ? 'Live' : 'Hors ligne'}</span>
          </span>
          <button
            onClick={() => load(true)}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <RefreshCw size={13} />
            <span className="hidden sm:inline">Actualiser</span>
          </button>
        </div>
      </div>

      {/* Mobile filter toggle */}
      <button
        onClick={() => setFiltersOpen(o => !o)}
        className="sm:hidden w-full flex items-center justify-between gap-2 bg-zinc-900/50 border border-zinc-800/80 rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-300"
      >
        <span className="flex items-center gap-2">
          <Filter size={14} className="text-indigo-400" />
          Filtres
          {activeFilterCount > 0 && (
            <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-zinc-500">
            {items.length}{hasMore ? '+' : ''}
          </span>
          <ChevronDown size={16} className={`transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {/* Filters */}
      <div
        className={`${filtersOpen ? 'flex' : 'hidden'} sm:flex bg-zinc-900/50 border border-zinc-800/80 p-4 sm:p-5 rounded-2xl flex-wrap gap-3 sm:gap-4 items-end backdrop-blur-md`}
      >
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Search size={12} />
            Recherche dans les titres
          </label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ex : Samsung 8gb…"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Keyword filter */}
        <div className="w-full sm:w-auto min-w-[180px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Filter size={12} />
            Mot-clé
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={selectedKw ?? ''}
            onChange={e => setSelectedKw(e.target.value ? parseInt(e.target.value) : undefined)}
          >
            <option value="">Tous</option>
            {keywords.map(kw => (
              <option key={kw.id} value={kw.id}>{kw.label}</option>
            ))}
          </select>
        </div>

        {/* Country filter */}
        <div className="w-full sm:w-auto min-w-[160px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Globe size={12} />
            Pays
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={country}
            onChange={e => setCountry(e.target.value)}
          >
            <option value="">Tous les pays</option>
            {Object.entries(COUNTRY_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>

        {/* Freshness filter */}
        <div className="w-full sm:w-auto min-w-[150px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Clock size={12} />
            Fraîcheur
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={maxAgeHours ?? ''}
            onChange={e => setMaxAgeHours(e.target.value ? parseInt(e.target.value) : undefined)}
          >
            <option value="">Toutes</option>
            <option value="1">Moins d'1h</option>
            <option value="6">Moins de 6h</option>
            <option value="24">Moins de 24h</option>
            <option value="168">Moins de 7 jours</option>
          </select>
        </div>

        {/* Solo seller toggle */}
        <div className="w-full sm:w-auto flex items-end">
          <button
            onClick={() => setSoloSeller(v => !v)}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              soloSeller
                ? 'bg-indigo-500/10 border-indigo-500 text-indigo-300'
                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            <UserCheck size={14} />
            Vendeur unique
          </button>
        </div>

        {/* Only deals toggle */}
        <div className="w-full sm:w-auto flex items-end">
          <button
            onClick={() => setOnlyDeals(v => !v)}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
              onlyDeals
                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300'
                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
            }`}
          >
            Bonnes affaires uniquement
          </button>
        </div>

        {/* Results count (desktop) */}
        <div className="hidden sm:flex h-10 items-center px-4 rounded-xl bg-zinc-950 text-xs font-mono border border-zinc-800 text-zinc-400 ml-auto justify-center">
          {items.length}{hasMore ? '+' : ''} annonce{items.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl p-16 text-center max-w-xl mx-auto space-y-3">
          <div className="bg-zinc-950 p-4 rounded-full inline-block border border-zinc-800">
            <Newspaper size={32} className="text-zinc-500" />
          </div>
          <h3 className="text-sm font-bold text-zinc-200">Aucune annonce trouvée</h3>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            Aucune annonce ne correspond à ces filtres. Élargissez la recherche ou attendez le prochain scan.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {items.map(kl => (
              <DealCard key={`${kl.keyword_id}-${kl.listing.id}`} kl={kl} live={liveIds.has(kl.listing.id)} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                <ChevronDown size={15} className={loadingMore ? 'animate-bounce' : ''} />
                {loadingMore ? 'Chargement…' : 'Charger plus d\'annonces'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

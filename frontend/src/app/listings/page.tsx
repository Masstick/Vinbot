'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, KeywordListing, Keyword } from '@/lib/api';
import { DealCard } from '@/components/DealCard';
import { Newspaper, Filter, Search, Clock, Globe, RefreshCw, ChevronDown } from 'lucide-react';

const PAGE_SIZE = 48;

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
  const [selectedKw, setSelectedKw] = useState<number | undefined>();
  const [country, setCountry] = useState<string>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [maxAgeHours, setMaxAgeHours] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);

  useEffect(() => {
    api.keywords.list().then(setKeywords).catch(() => {});
  }, []);

  // Debounce de la recherche texte (requête serveur)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const baseParams = useCallback(() => ({
    keywordId: selectedKw,
    country: country || undefined,
    q: debouncedSearch || undefined,
    maxAgeHours,
    limit: PAGE_SIZE,
  }), [selectedKw, country, debouncedSearch, maxAgeHours]);

  const load = useCallback((showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    api.listings.latest({ ...baseParams(), offset: 0 })
      .then(rows => {
        offsetRef.current = rows.length;
        setItems(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
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
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
            <Newspaper className="text-indigo-400" size={26} />
            Dernières annonces
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Toutes les annonces détectées, des plus récentes aux plus anciennes. Actualisation auto toutes les 30s.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          <RefreshCw size={13} />
          Actualiser
        </button>
      </div>

      {/* Filters */}
      <div className="bg-zinc-900/50 border border-zinc-800/80 p-5 rounded-2xl flex flex-wrap gap-4 items-end backdrop-blur-md">
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

        {/* Results count */}
        <div className="h-10 flex items-center px-4 rounded-xl bg-zinc-950 text-xs font-mono border border-zinc-800 text-zinc-400 ml-auto justify-center">
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
              <DealCard key={`${kl.keyword_id}-${kl.listing.id}`} kl={kl} />
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

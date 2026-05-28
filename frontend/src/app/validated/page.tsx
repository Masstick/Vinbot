'use client';
import { useEffect, useState, useMemo } from 'react';
import { api, KeywordListing } from '@/lib/api';
import { DealCard } from '@/components/DealCard';
import { ShieldCheck, ArrowUpDown, Filter, TrendingUp, AlertCircle, Sparkles } from 'lucide-react';

function getFreshnessHours(listing: KeywordListing['listing']): number {
  if (listing.freshness_hours !== undefined) return listing.freshness_hours;
  const ref = listing.vinted_created_at ?? listing.first_seen_at;
  return (Date.now() - new Date(ref).getTime()) / 3_600_000;
}

function SkeletonCard() {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl overflow-hidden h-[360px] flex flex-col justify-between p-4 animate-pulse">
      <div className="w-full h-44 bg-zinc-800/50 rounded-xl mb-4" />
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

type SortMode = 'profit-desc' | 'score-desc' | 'fresh-asc';
type RecommendationFilter = 'all' | 'buy' | 'watch';
type ScamFilter = 'all' | 'low' | 'medium';

export default function ValidatedPage() {
  const [kls, setKls] = useState<KeywordListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortMode>('profit-desc');
  const [recommendationFilter, setRecommendationFilter] = useState<RecommendationFilter>('all');
  const [scamFilter, setScamFilter] = useState<ScamFilter>('all');

  useEffect(() => {
    setLoading(true);
    api.listings
      .validated()
      .then(data => setKls(data as KeywordListing[]))
      .catch(() => setKls([]))
      .finally(() => setLoading(false));
  }, []);

  const processed = useMemo(() => {
    let items = [...kls];

    // Filter by recommendation
    if (recommendationFilter !== 'all') {
      items = items.filter(kl => kl.recommendation === recommendationFilter);
    }

    // Filter by scam risk
    if (scamFilter !== 'all') {
      items = items.filter(kl => kl.scam_risk === scamFilter);
    }

    // Sort
    items.sort((a, b) => {
      if (sortBy === 'profit-desc') {
        const pA = a.potential_profit ? parseFloat(String(a.potential_profit)) : 0;
        const pB = b.potential_profit ? parseFloat(String(b.potential_profit)) : 0;
        return pB - pA;
      }
      if (sortBy === 'score-desc') {
        const sA = a.deal_score ? parseFloat(String(a.deal_score)) : 0;
        const sB = b.deal_score ? parseFloat(String(b.deal_score)) : 0;
        return sB - sA;
      }
      if (sortBy === 'fresh-asc') {
        const fA = getFreshnessHours(a.listing);
        const fB = getFreshnessHours(b.listing);
        return fA - fB;
      }
      return 0;
    });

    return items;
  }, [kls, sortBy, recommendationFilter, scamFilter]);

  // Summary stats
  const stats = useMemo(() => {
    if (kls.length === 0) return null;
    const profits = kls
      .map(kl => (kl.potential_profit ? parseFloat(String(kl.potential_profit)) : null))
      .filter((p): p is number => p !== null);
    const avgProfit =
      profits.length > 0
        ? profits.reduce((a, b) => a + b, 0) / profits.length
        : 0;
    const bestProfit = profits.length > 0 ? Math.max(...profits) : 0;
    return { count: kls.length, avgProfit, bestProfit };
  }, [kls]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
          <ShieldCheck className="text-emerald-400" size={26} />
          Deals validés
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Les meilleures opportunités d'arbitrage, triées et filtrées.
        </p>
      </div>

      {/* Stats banner */}
      {!loading && stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl px-5 py-3 flex items-center gap-3">
            <Sparkles size={18} className="text-indigo-400 shrink-0" />
            <div>
              <p className="text-xs text-zinc-500">Deals validés</p>
              <p className="text-lg font-extrabold text-white">{stats.count}</p>
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl px-5 py-3 flex items-center gap-3">
            <TrendingUp size={18} className="text-cyan-400 shrink-0" />
            <div>
              <p className="text-xs text-zinc-500">Profit moyen</p>
              <p className="text-lg font-extrabold text-cyan-400">
                +{stats.avgProfit.toFixed(0)}€
              </p>
            </div>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl px-5 py-3 flex items-center gap-3">
            <TrendingUp size={18} className="text-emerald-400 shrink-0" />
            <div>
              <p className="text-xs text-zinc-500">Meilleur deal</p>
              <p className="text-lg font-extrabold text-emerald-400">
                +{stats.bestProfit.toFixed(0)}€
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-zinc-900/50 border border-zinc-800/80 p-4 rounded-2xl flex flex-wrap gap-4 items-end backdrop-blur-md">
        {/* Recommendation filter */}
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Filter size={12} />
            Recommandation
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={recommendationFilter}
            onChange={e => setRecommendationFilter(e.target.value as RecommendationFilter)}
          >
            <option value="all">Toutes</option>
            <option value="buy">Acheter (buy)</option>
            <option value="watch">À surveiller (watch)</option>
          </select>
        </div>

        {/* Scam risk filter */}
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <AlertCircle size={12} />
            Risque arnaque
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={scamFilter}
            onChange={e => setScamFilter(e.target.value as ScamFilter)}
          >
            <option value="all">Tous</option>
            <option value="low">Faible</option>
            <option value="medium">Moyen</option>
          </select>
        </div>

        {/* Sort */}
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowUpDown size={12} />
            Trier par
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortMode)}
          >
            <option value="profit-desc">Profit décroissant</option>
            <option value="score-desc">Deal score décroissant</option>
            <option value="fresh-asc">Plus récent en premier</option>
          </select>
        </div>

        <div className="h-10 flex items-center px-4 rounded-xl bg-zinc-950 text-xs font-mono border border-zinc-800 text-zinc-400 ml-auto">
          {processed.length} deal{processed.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : processed.length === 0 ? (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl p-16 text-center max-w-xl mx-auto space-y-3">
          <div className="bg-zinc-950 p-4 rounded-full inline-block border border-zinc-800">
            <ShieldCheck size={32} className="text-zinc-500" />
          </div>
          <h3 className="text-sm font-bold text-zinc-200">Aucun deal validé</h3>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            Aucun deal ne correspond à vos filtres. Modifiez la recommandation ou le filtre de risque.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {processed.map(kl => (
            <DealCard key={`${kl.keyword_id}-${kl.listing_id}`} kl={kl} />
          ))}
        </div>
      )}
    </div>
  );
}

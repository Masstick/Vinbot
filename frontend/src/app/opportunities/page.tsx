'use client';
import { useEffect, useState, useMemo } from 'react';
import { api, KeywordListing, Keyword } from '@/lib/api';
import { DealCard } from '@/components/DealCard';
import { Filter, SlidersHorizontal, ArrowUpDown, ShieldAlert, Sparkles } from 'lucide-react';

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

export default function OpportunitiesPage() {
  const [kls, setKls] = useState<KeywordListing[]>([]);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [selectedKw, setSelectedKw] = useState<number | undefined>();
  const [minProfit, setMinProfit] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>('profit-desc'); // profit-desc, score-desc, date-desc
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.keywords.list().then(setKeywords).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.listings.opportunities(selectedKw)
      .then(data => setKls(data as KeywordListing[]))
      .catch(() => setKls([]))
      .finally(() => setLoading(false));
  }, [selectedKw]);

  // Filtrage et Tri
  const processedListings = useMemo(() => {
    // 1. Filtrer
    let items = kls.filter(kl => {
      const profit = kl.potential_profit ? parseFloat(String(kl.potential_profit)) : 0;
      return profit >= minProfit;
    });

    // 2. Trier
    items.sort((a, b) => {
      if (sortBy === 'profit-desc') {
        const profitA = a.potential_profit ? parseFloat(String(a.potential_profit)) : 0;
        const profitB = b.potential_profit ? parseFloat(String(b.potential_profit)) : 0;
        return profitB - profitA;
      }
      if (sortBy === 'score-desc') {
        const scoreA = a.deal_score ? parseFloat(String(a.deal_score)) : 0;
        const scoreB = b.deal_score ? parseFloat(String(b.deal_score)) : 0;
        return scoreB - scoreA;
      }
      if (sortBy === 'date-desc') {
        const refA = a.listing.vinted_created_at ?? a.listing.first_seen_at;
        const refB = b.listing.vinted_created_at ?? b.listing.first_seen_at;
        return new Date(refB).getTime() - new Date(refA).getTime();
      }
      return 0;
    });

    return items;
  }, [kls, minProfit, sortBy]);

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
          <Sparkles className="text-indigo-400" size={26} />
          Centre d'arbitrage
        </h1>
        <p className="text-sm text-zinc-400 mt-1">Détectez et triez les annonces Vinted présentant la meilleure rentabilité.</p>
      </div>

      {/* Control Panel / Filters */}
      <div className="bg-zinc-900/50 border border-zinc-800/80 p-5 rounded-2xl flex flex-wrap gap-4 items-end backdrop-blur-md">
        {/* Mot-clé filter */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Filter size={12} />
            Mots-clés surveillés
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={selectedKw ?? ''}
            onChange={e => setSelectedKw(e.target.value ? parseInt(e.target.value) : undefined)}
          >
            <option value="">Tous les mots-clés</option>
            {keywords.map(kw => (
              <option key={kw.id} value={kw.id}>{kw.label}</option>
            ))}
          </select>
        </div>

        {/* Min Profit filter */}
        <div className="w-full sm:w-auto min-w-[120px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <SlidersHorizontal size={12} />
            Marge min (€)
          </label>
          <input
            type="number"
            min="0"
            step="5"
            value={minProfit}
            onChange={e => setMinProfit(parseFloat(e.target.value) || 0)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Sort select */}
        <div className="w-full sm:w-auto min-w-[200px]">
          <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowUpDown size={12} />
            Trier par
          </label>
          <select
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 transition-colors"
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
          >
            <option value="profit-desc">Marge estimée (décroissante)</option>
            <option value="score-desc">Score du Deal (décroissant)</option>
            <option value="date-desc">Mise en ligne la plus récente</option>
          </select>
        </div>

        {/* Results Count Badge */}
        <div className="h-10 flex items-center px-4 rounded-xl bg-zinc-950 text-xs font-mono border border-zinc-800 text-zinc-400 ml-auto justify-center">
          {processedListings.length} opportunité{processedListings.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Grid of cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : processedListings.length === 0 ? (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl p-16 text-center max-w-xl mx-auto space-y-3">
          <div className="bg-zinc-950 p-4 rounded-full inline-block border border-zinc-800">
            <ShieldAlert size={32} className="text-zinc-500" />
          </div>
          <h3 className="text-sm font-bold text-zinc-200">Aucun arbitrage trouvé</h3>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            Aucun deal ne correspond à vos filtres actuels. Modifiez la marge minimale ou sélectionnez un autre mot-clé.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {processedListings.map(kl => (
            <DealCard key={`${kl.keyword_id}-${kl.listing_id}`} kl={kl} />
          ))}
        </div>
      )}
    </div>
  );
}

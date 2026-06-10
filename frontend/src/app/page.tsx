'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, KeywordListing, Stats } from '@/lib/api';
import { DealCard } from '@/components/DealCard';
import { RefreshCw, Database, Hash, Bell, Bot, Calendar, Sparkles, Plus } from 'lucide-react';

function ScraperStatusBar({ status }: { status: any }) {
  const [tick, setTick] = useState(0);

  // Countdown local en JS — rafraîchi toutes les secondes
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => {
      clearInterval(t);
      setTick(0);
    };
  }, [status]); // Reset tick when status changes

  if (!status) return null;

  const isRunning = status.isFastRunning || status.isMarketRunning;
  const keywords: { id: number; label: string; lastRunAt: string | null; countryCodes?: string[] }[] =
    status.keywords ?? [];

  // tick force le re-render chaque seconde pour rafraîchir les durées affichées
  void tick;

  return (
    <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 glow-indigo backdrop-blur-md">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex h-3 w-3">
          {isRunning ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </>
          ) : (
            <>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </>
          )}
        </div>
        <span className="text-sm font-semibold text-zinc-200">
          {status.bootstrappingKeyword
            ? `Construction de l'historique pour « ${status.bootstrappingKeyword} »…`
            : isRunning
            ? 'Scraper en cours de recherche…'
            : 'Scraper en veille (prochain scan < 35s)'}
        </span>
        {status.lastScrapeTime && (
          <span className="text-xs text-zinc-500 ml-auto flex items-center gap-1">
            <Calendar size={12} />
            Dernier cycle : {new Date(status.lastScrapeTime).toLocaleTimeString('fr-FR')}
          </span>
        )}
      </div>

      {keywords.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {keywords.map(kw => {
            const elapsed = kw.lastRunAt
              ? Math.max(0, Math.round((Date.now() - new Date(kw.lastRunAt).getTime()) / 1000))
              : null;

            return (
              <div key={kw.id} className="bg-zinc-950/40 border border-zinc-900 rounded-xl p-3 flex flex-col justify-center gap-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-zinc-300 truncate max-w-[150px]">{kw.label}</span>
                  <span className="text-zinc-500 font-mono">
                    {elapsed === null
                      ? 'en attente du 1er scan'
                      : elapsed < 60
                      ? `scanné il y a ${elapsed}s`
                      : `scanné il y a ${Math.floor(elapsed / 60)}min`}
                  </span>
                </div>
                {kw.countryCodes && kw.countryCodes.length > 0 && (
                  <span className="text-[10px] text-zinc-600 uppercase tracking-wide font-mono">
                    {kw.countryCodes.join(' · ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">Aucun mot-clé actif pour le scraper.</p>
      )}
    </div>
  );
}

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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [opportunities, setOpportunities] = useState<KeywordListing[]>([]);
  const [scraperStatus, setScraperStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback((showIndicator = false) => {
    if (showIndicator) setRefreshing(true);
    Promise.all([
      api.listings.stats().catch(() => null),
      api.listings.opportunities().catch(() => []),
      api.scraper.status().catch(() => null),
    ]).then(([s, ops, sc]) => {
      setStats(s);
      setOpportunities((ops as KeywordListing[]).slice(0, 10));
      setScraperStatus(sc);
      setLoading(false);
      setRefreshing(false);
    });
  }, []);

  useEffect(() => {
    loadData();
    // Rafraîchissement auto toutes les 30s
    const interval = setInterval(() => loadData(false), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <div className="space-y-8">
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
            <Bot className="text-indigo-400" size={28} />
            Tableau de bord
          </h1>
          <p className="text-sm text-zinc-400 mt-1">Surveillance en temps réel et détection de marges.</p>
        </div>
        <button
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Actualisation...' : 'Actualiser'}
        </button>
      </div>

      {/* Scraper Status */}
      <ScraperStatusBar status={scraperStatus} />

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {[
          {
            label: 'Annonces analysées',
            value: stats?.total_listings ?? '—',
            icon: Database,
            color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20 glow-indigo',
          },
          {
            label: 'Nouvelles (24h)',
            value: stats?.listings_24h ?? '—',
            icon: Sparkles,
            color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          },
          {
            label: 'Deals validés IA',
            value: stats?.validated_deals ?? '—',
            icon: Bot,
            color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
          },
          {
            label: 'Mots-clés surveillés',
            value: stats?.active_keywords ?? '—',
            icon: Hash,
            color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20 glow-cyan',
          },
          {
            label: 'Alertes (24h)',
            value: stats?.alerts_24h ?? '—',
            icon: Bell,
            color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
          },
        ].map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={idx}
              className={`bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 flex items-center justify-between hover:border-zinc-700/60 transition-all duration-300`}
            >
              <div className="space-y-1">
                <div className="text-3xl font-black text-white tracking-tight">{s.value}</div>
                <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{s.label}</div>
              </div>
              <div className={`p-3 rounded-xl border ${s.color}`}>
                <Icon size={22} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Opportunities Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Sparkles size={18} className="text-yellow-400" />
            Top 10 opportunités de revente
          </h2>
          <Link
            href="/opportunities"
            className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
          >
            Voir tout
            <span className="text-zinc-600 font-normal">({opportunities.length})</span> →
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : opportunities.length === 0 ? (
          <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-2xl p-12 text-center max-w-xl mx-auto space-y-4">
            <div className="bg-zinc-950 p-4 rounded-full inline-block border border-zinc-800">
              <Bot size={32} className="text-zinc-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-zinc-200">Aucune opportunité disponible</h3>
              <p className="text-xs text-zinc-500 max-w-sm mx-auto">
                Le scraper n'a pas encore détecté d'annonces sous la moyenne du marché. Ajoutez des mots-clés de recherche pour lancer la surveillance.
              </p>
            </div>
            <Link
              href="/keywords"
              className="inline-flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md glow-indigo transition-colors"
            >
              <Plus size={14} />
              Ajouter un mot-clé
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {opportunities.map(kl => (
              <DealCard key={`${kl.keyword_id}-${kl.listing_id}`} kl={kl} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

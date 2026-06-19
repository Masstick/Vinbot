'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, Stats } from '@/lib/api';
import { useKeywordChanged } from '@/lib/useKeywordChanged';
import { useRefreshSignal } from '@/lib/refreshEvent';
import { useCurrentUser } from '@/lib/CurrentUserContext';
import { RefreshCw, Database, Hash, Bell, Sparkles } from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { activeUserId } = useCurrentUser();

  const loadData = useCallback((showIndicator = false) => {
    if (showIndicator) setRefreshing(true);
    api.listings
      .stats(activeUserId ?? undefined)
      .catch(() => null)
      .then(s => {
        setStats(s);
        setRefreshing(false);
      });
  }, [activeUserId]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(false), 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  useKeywordChanged(() => loadData(false));
  useRefreshSignal(() => loadData(true));

  const cards = [
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
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">Statistiques</h1>
        <button
          onClick={() => loadData(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{refreshing ? 'Actualisation...' : 'Actualiser'}</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((s, idx) => {
          const Icon = s.icon;
          return (
            <div
              key={idx}
              className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 sm:p-6 flex items-center justify-between gap-3 hover:border-zinc-700/60 transition-all duration-300"
            >
              <div className="space-y-1 min-w-0">
                <div className="text-2xl sm:text-3xl font-black text-white tracking-tight">{s.value}</div>
                <div className="text-[10px] sm:text-xs font-semibold text-zinc-500 uppercase tracking-wider">{s.label}</div>
              </div>
              <div className={`p-2.5 sm:p-3 rounded-xl border shrink-0 ${s.color}`}>
                <Icon size={20} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

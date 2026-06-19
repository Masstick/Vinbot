'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Le scraper tourne par tick toutes les ~25–35s (scheduleFastTick côté backend),
// on estime donc le prochain scan à ~30s après le dernier.
const NEXT_SCAN_ESTIMATE_S = 30;

interface Status {
  isFastRunning?: boolean;
  paused?: boolean;
  lastScrapeTime?: string | null;
}

export function ScraperStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const fetchStatus = () => api.scraper.status().then(setStatus).catch(() => {});
    fetchStatus();
    const poll = setInterval(fetchStatus, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const paused = status?.paused;
  const running = status?.isFastRunning;
  const lastMs = status?.lastScrapeTime ? new Date(status.lastScrapeTime).getTime() : null;
  const since = lastMs != null ? Math.max(0, Math.round((now - lastMs) / 1000)) : null;
  const nextIn = since != null ? Math.max(0, NEXT_SCAN_ESTIMATE_S - since) : null;

  const title = paused ? 'Scraper en pause' : running ? 'Scan en cours…' : 'Surveillance active';
  const detail = paused
    ? 'Reprise manuelle requise'
    : since == null
    ? 'En attente du 1er scan'
    : running
    ? `Dernier scan il y a ${since}s`
    : nextIn === 0
    ? `Scan il y a ${since}s · imminent`
    : `Scan il y a ${since}s · prochain ~${nextIn}s`;

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-zinc-950/40 border border-zinc-800/40">
      <div className="relative flex h-2.5 w-2.5 shrink-0">
        {!paused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${paused ? 'bg-zinc-600' : 'bg-emerald-500'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-zinc-200">{title}</p>
        <p className="text-[10px] text-zinc-500 truncate tabular-nums">{detail}</p>
      </div>
    </div>
  );
}

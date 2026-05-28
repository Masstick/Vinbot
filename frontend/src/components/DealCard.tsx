'use client';
import { useState } from 'react';
import Link from 'next/link';
import { KeywordListing } from '@/lib/api';
import { ExternalLink, TrendingDown, ArrowUpRight, Clock } from 'lucide-react';

// ─── Freshness ────────────────────────────────────────────────────────────────

function getFreshnessHours(listing: KeywordListing['listing']): number {
  if (listing.freshness_hours !== undefined) return listing.freshness_hours;
  const ref = listing.vinted_created_at ?? listing.first_seen_at;
  return (Date.now() - new Date(ref).getTime()) / 3_600_000;
}

interface FreshnessBadgeProps {
  hours: number;
}

function FreshnessBadge({ hours }: FreshnessBadgeProps) {
  if (hours < 1) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
        <Clock size={10} />
        &lt; 1h
      </span>
    );
  }
  if (hours < 6) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
        <Clock size={10} />
        &lt; 6h
      </span>
    );
  }
  if (hours < 24) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg bg-sky-500/15 text-sky-400 border border-sky-500/30">
        <Clock size={10} />
        &lt; 24h
      </span>
    );
  }
  return null;
}

// ─── Condition badge ──────────────────────────────────────────────────────────

function ConditionBadge({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  if (normalized.includes('neuf')) {
    return (
      <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-semibold">
        {label}
      </span>
    );
  }
  if (normalized.includes('très bon') || normalized.includes('bon état')) {
    return (
      <span className="bg-sky-500/10 text-sky-400 border border-sky-500/20 px-2 py-0.5 rounded text-[10px] font-semibold">
        {label}
      </span>
    );
  }
  if (normalized.includes('satisf')) {
    return (
      <span className="bg-zinc-700/60 text-zinc-400 border border-zinc-600/30 px-2 py-0.5 rounded text-[10px] font-semibold">
        {label}
      </span>
    );
  }
  return (
    <span className="bg-zinc-800/40 text-zinc-500 border border-zinc-800/50 px-2 py-0.5 rounded text-[10px] font-medium">
      {label}
    </span>
  );
}

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const color =
    pct >= 60
      ? 'bg-emerald-500'
      : pct >= 30
      ? 'bg-amber-500'
      : 'bg-rose-500';

  return (
    <div className="w-full bg-zinc-800 rounded-full h-4 overflow-hidden relative">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mix-blend-luminosity">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Country flag ─────────────────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  be: '🇧🇪',
  es: '🇪🇸',
  pl: '🇵🇱',
  de: '🇩🇪',
  nl: '🇳🇱',
  it: '🇮🇹',
  pt: '🇵🇹',
  se: '🇸🇪',
  gb: '🇬🇧',
  at: '🇦🇹',
  ch: '🇨🇭',
};

function countryFlag(code: string): string | null {
  const c = code.toLowerCase();
  if (c === 'fr') return null;
  return FLAGS[c] ?? null;
}

// ─── Reasoning snippet ────────────────────────────────────────────────────────

function ReasoningSnippet({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > 100;
  const display = !truncated || expanded ? text : `${text.slice(0, 100)}…`;

  return (
    <p
      className="text-[11px] italic text-zinc-400 leading-snug cursor-pointer"
      onClick={() => setExpanded(e => !e)}
      title={truncated ? (expanded ? 'Réduire' : 'Afficher tout') : undefined}
    >
      {display}
      {truncated && (
        <span className="ml-1 text-indigo-400 not-italic font-medium">
          {expanded ? ' moins' : ' plus'}
        </span>
      )}
    </p>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

interface Props {
  kl: KeywordListing;
}

export function DealCard({ kl }: Props) {
  const { listing, keyword, deal_score, market_avg, potential_profit } = kl;
  const price = listing.price ? parseFloat(String(listing.price)) : null;
  const avg = market_avg ? parseFloat(String(market_avg)) : null;
  const profit = potential_profit ? parseFloat(String(potential_profit)) : null;
  const score = deal_score ? parseFloat(String(deal_score)) : null;

  const freshnessHours = getFreshnessHours(listing);
  const flag = listing.country_code ? countryFlag(listing.country_code) : null;

  return (
    <div className="group bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-zinc-700/80 hover:shadow-xl transition-all duration-300 hover:scale-[1.01] flex flex-col h-full">
      {/* Product Image */}
      <div className="relative aspect-[3/2] bg-zinc-950 overflow-hidden w-full shrink-0">
        <Link href={`/listings/${listing.id}`}>
          {listing.photo_url ? (
            <img
              src={listing.photo_url}
              alt={listing.title ?? ''}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
              Aucune image
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
        </Link>

        {/* Deal Score badge (top right) */}
        {score !== null && (
          <span
            className={`absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border backdrop-blur-md ${
              score >= 40
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : score >= 20
                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            }`}
          >
            <TrendingDown size={12} />
            -{score.toFixed(0)}%
          </span>
        )}

        {/* Freshness badge (top left) */}
        <span className="absolute top-2.5 left-2.5 backdrop-blur-md">
          <FreshnessBadge hours={freshnessHours} />
        </span>

        {/* Keyword label overlay (bottom left) */}
        <span className="absolute bottom-2 left-2 text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded bg-zinc-950/80 text-zinc-400 border border-zinc-800/80 backdrop-blur-md">
          {keyword.label}
        </span>
      </div>

      {/* Product Details */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-2">
          {/* Brand / Size / Condition badges */}
          <div className="flex flex-wrap gap-1">
            {listing.brand && (
              <span className="bg-zinc-800/60 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-700/30">
                {listing.brand}
              </span>
            )}
            {listing.size_label && (
              <span className="bg-zinc-800/60 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-700/30">
                Taille : {listing.size_label}
              </span>
            )}
            {listing.condition_label && (
              <ConditionBadge label={listing.condition_label} />
            )}
          </div>

          {/* Title + optional country flag */}
          <Link
            href={`/listings/${listing.id}`}
            className="flex items-center gap-1 text-sm font-semibold text-zinc-100 hover:text-indigo-400 transition-colors line-clamp-1 mt-1"
          >
            {flag && <span className="shrink-0 text-base leading-none">{flag}</span>}
            <span className="line-clamp-1">{listing.title ?? 'Sans titre'}</span>
          </Link>

          {/* Pricing */}
          <div className="flex items-baseline justify-between pt-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-white">{price?.toFixed(1)}€</span>
              {avg && (
                <span className="text-xs text-zinc-500 line-through">
                  Moy. {avg.toFixed(0)}€
                </span>
              )}
            </div>
            {/* Profit highlight */}
            {profit !== null && profit > 0 && (
              <span
                className={`text-lg font-extrabold ${
                  profit >= 30
                    ? 'text-emerald-400'
                    : profit >= 15
                    ? 'text-cyan-400'
                    : 'text-amber-400'
                }`}
              >
                +{profit.toFixed(0)}€
              </span>
            )}
          </div>

          {/* Score bar */}
          {score !== null && (
            <div className="pt-1">
              <ScoreBar score={score} />
            </div>
          )}

          {/* AI Reasoning snippet */}
          {listing.reasoning && (
            <div className="pt-1">
              <ReasoningSnippet text={listing.reasoning} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-2 border-t border-zinc-800/50">
          {listing.url && (
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-bold py-2.5 rounded-xl transition-all shadow-md"
            >
              Voir sur Vinted
              <ExternalLink size={13} />
            </a>
          )}
          <Link
            href={`/listings/${listing.id}`}
            className="flex items-center justify-center gap-1 w-full text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-2 rounded-xl transition-colors font-medium border border-zinc-700/30 group-hover:border-zinc-600"
          >
            Détails
            <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}

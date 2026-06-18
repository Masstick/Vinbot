'use client';
import Link from 'next/link';
import { KeywordListing } from '@/lib/api';
import { ExternalLink, ArrowUpRight, Clock } from 'lucide-react';

// ─── Freshness ────────────────────────────────────────────────────────────────

function getFreshnessHours(listing: KeywordListing['listing']): number {
  if (listing.freshness_hours !== undefined) return listing.freshness_hours;
  const ref = listing.vinted_created_at ?? listing.first_seen_at;
  return (Date.now() - new Date(ref).getTime()) / 3_600_000;
}

function FreshnessBadge({ hours }: { hours: number }) {
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

// ─── Main card ────────────────────────────────────────────────────────────────

interface Props {
  kl: KeywordListing;
}

export function DealCard({ kl }: Props) {
  const { listing, keyword } = kl;
  const price = listing.price ? parseFloat(String(listing.price)) : null;

  const freshnessHours = getFreshnessHours(listing);
  const flagCode = listing.seller_country ?? listing.country_code;
  const flag = flagCode ? countryFlag(flagCode) : null;

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
          <div className="flex items-baseline pt-1">
            <span className="text-xl font-black text-white">{price?.toFixed(1)}€</span>
          </div>
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

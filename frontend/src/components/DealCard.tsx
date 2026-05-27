'use client';
import Link from 'next/link';
import { KeywordListing } from '@/lib/api';
import { ExternalLink, TrendingDown, ArrowUpRight, Tag, Sparkles, AlertTriangle, Clock } from 'lucide-react';

function getScoreStyle(score: number | null) {
  if (score === null) return 'bg-zinc-800 text-zinc-400 border-zinc-700/50';
  if (score >= 40) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 glow-emerald';
  if (score >= 20) return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 glow-cyan';
  return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
}

function getProfitStyle(profit: number | null) {
  if (profit === null || profit < 0) return 'text-zinc-500';
  if (profit >= 30) return 'text-emerald-400 font-extrabold';
  if (profit >= 15) return 'text-cyan-400 font-bold';
  return 'text-amber-400 font-semibold';
}

function isFresh(firstSeenAt: string): boolean {
  return Date.now() - new Date(firstSeenAt).getTime() < 5 * 60 * 1000;
}

interface Props { kl: KeywordListing; }

export function DealCard({ kl }: Props) {
  const { listing, keyword, deal_score, market_avg, model_market_avg, potential_profit, analysis } = kl;
  const price = listing.price ? parseFloat(String(listing.price)) : null;
  const effectiveAvg = model_market_avg
    ? parseFloat(String(model_market_avg))
    : market_avg ? parseFloat(String(market_avg)) : null;
  const profit = potential_profit ? parseFloat(String(potential_profit)) : null;
  const score = deal_score ? parseFloat(String(deal_score)) : null;
  const fresh = isFresh(listing.first_seen_at);
  const aiConfidence = analysis?.confidence ? parseFloat(String(analysis.confidence)) : null;

  return (
    <div className="group bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-zinc-700/80 hover:shadow-xl transition-all duration-300 hover:scale-[1.01] flex flex-col h-full">
      {/* Image */}
      <div className="relative aspect-[4/3] bg-zinc-950 overflow-hidden w-full shrink-0">
        <Link href={`/listings/${listing.id}`}>
          {listing.photo_url ? (
            <img src={listing.photo_url} alt={listing.title ?? ''} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Aucune image</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
        </Link>

        {score !== null && (
          <span className={`absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border backdrop-blur-md ${getScoreStyle(score)}`}>
            <TrendingDown size={12} />-{score.toFixed(0)}%
          </span>
        )}

        {fresh && (
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border backdrop-blur-md bg-indigo-500/20 text-indigo-300 border-indigo-500/40">
            <Clock size={10} />🆕 NOUVEAU
          </span>
        )}

        <span className="absolute bottom-2 left-2 text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded bg-zinc-950/80 text-zinc-400 border border-zinc-800/80 backdrop-blur-md">
          {keyword.label}
        </span>
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {listing.brand && <span className="bg-zinc-800/60 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-700/30">{listing.brand}</span>}
            {listing.condition_label && <span className="bg-zinc-800/40 text-zinc-400 px-2 py-0.5 rounded text-[10px] font-medium border border-zinc-800/50">{listing.condition_label}</span>}
          </div>

          {listing.model_label && (
            <div className="flex items-center gap-1 text-[10px] text-indigo-400">
              <Sparkles size={10} />
              <span className="font-mono font-semibold">{listing.model_label}</span>
            </div>
          )}

          <Link href={`/listings/${listing.id}`} className="block text-sm font-semibold text-zinc-100 hover:text-indigo-400 transition-colors line-clamp-1 mt-1">
            {listing.title ?? 'Sans titre'}
          </Link>

          <div className="flex items-baseline justify-between pt-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-black text-white">{price?.toFixed(1)}€</span>
              {effectiveAvg && (
                <span className="text-xs text-zinc-500 line-through">
                  Moy.{model_market_avg ? ' modèle' : ''} {effectiveAvg.toFixed(0)}€
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-zinc-800/50">
          {profit !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">Marge estimée :</span>
              <span className={`text-sm ${getProfitStyle(profit)} flex items-center font-bold`}>
                {profit >= 0 ? '+' : ''}{profit.toFixed(0)}€
              </span>
            </div>
          )}

          {aiConfidence !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500 flex items-center gap-1"><Sparkles size={10} /> IA :</span>
              <span className={`font-bold text-xs ${aiConfidence >= 0.8 ? 'text-emerald-400' : aiConfidence >= 0.6 ? 'text-amber-400' : 'text-zinc-400'}`}>
                {Math.round(aiConfidence * 100)}% confiance
              </span>
            </div>
          )}

          {analysis?.scam_risk === 'medium' && (
            <div className="flex items-center gap-1 text-[10px] text-amber-400">
              <AlertTriangle size={10} />
              <span>Risque moyen — vérifiez l'annonce</span>
            </div>
          )}
          {analysis?.scam_risk === 'high' && (
            <div className="flex items-center gap-1 text-[10px] text-rose-400">
              <AlertTriangle size={10} />
              <span>Risque élevé détecté</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Link href={`/listings/${listing.id}`} className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-2 rounded-xl transition-colors font-medium border border-zinc-700/30 flex items-center justify-center gap-1 group-hover:border-zinc-600">
              Détails <ArrowUpRight size={13} />
            </Link>
            {listing.url && (
              <a href={listing.url} target="_blank" rel="noopener noreferrer" className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-xl transition-all duration-200 flex items-center justify-center glow-indigo" title="Ouvrir sur Vinted">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ValidatedDeal } from '@/lib/api';
import { ShieldCheck, ExternalLink, Sparkles, Clock, AlertTriangle } from 'lucide-react';

function isFresh(firstSeenAt: string): boolean {
  return Date.now() - new Date(firstSeenAt).getTime() < 5 * 60 * 1000;
}

function RecommendationBadge({ rec }: { rec: string }) {
  if (rec === 'buy') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
      ✅ ACHETER
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
      👀 SURVEILLER
    </span>
  );
}

export default function ValidatedPage() {
  const [deals, setDeals] = useState<ValidatedDeal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listings.validated(50)
      .then(setDeals)
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
          <ShieldCheck className="text-emerald-400" size={26} />
          Deals validés par IA
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Uniquement les annonces analysées et confirmées par Mistral. Recommandation "acheter" ou "surveiller", risque scam exclu.
        </p>
      </div>

      {loading ? (
        <div className="text-center text-zinc-500 py-24 animate-pulse">Analyse en cours…</div>
      ) : deals.length === 0 ? (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-2xl p-16 text-center space-y-3">
          <div className="bg-zinc-950 p-4 rounded-full inline-block border border-zinc-800">
            <Sparkles size={32} className="text-zinc-500" />
          </div>
          <h3 className="text-sm font-bold text-zinc-200">Aucun deal validé pour l'instant</h3>
          <p className="text-xs text-zinc-500 max-w-xs mx-auto">
            Mistral analyse les candidats en arrière-plan. Revenez dans quelques minutes après le prochain cycle de scraping.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {deals.map(deal => {
            const price = parseFloat(String(deal.price ?? 0));
            const effectiveAvg = deal.model_market_avg
              ? parseFloat(String(deal.model_market_avg))
              : deal.market_avg ? parseFloat(String(deal.market_avg)) : null;
            const profit = deal.potential_profit ? parseFloat(String(deal.potential_profit)) : null;
            const confidence = deal.analysis_confidence ? parseFloat(String(deal.analysis_confidence)) : null;
            const fresh = isFresh(deal.first_seen_at);

            return (
              <div key={`${deal.keyword_id}-${deal.listing_id}`} className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden hover:border-emerald-700/40 hover:shadow-xl transition-all duration-300 flex flex-col">
                <div className="relative aspect-[4/3] bg-zinc-950 overflow-hidden">
                  <Link href={`/listings/${deal.listing_id}`}>
                    {deal.photo_url ? (
                      <img src={deal.photo_url} alt={deal.title ?? ''} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Aucune image</div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
                  </Link>
                  {fresh && (
                    <span className="absolute top-2.5 left-2.5 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border backdrop-blur-md bg-indigo-500/20 text-indigo-300 border-indigo-500/40">
                      <Clock size={10} />🆕 NOUVEAU
                    </span>
                  )}
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium uppercase px-2 py-0.5 rounded bg-zinc-950/80 text-zinc-400 border border-zinc-800/80">
                    {deal.keyword_label}
                  </span>
                </div>

                <div className="p-4 flex-1 flex flex-col gap-3">
                  {deal.model_label && (
                    <div className="flex items-center gap-1 text-[10px] text-indigo-400">
                      <Sparkles size={10} />
                      <span className="font-mono font-semibold">{deal.model_label}</span>
                    </div>
                  )}

                  <Link href={`/listings/${deal.listing_id}`} className="text-sm font-semibold text-zinc-100 hover:text-indigo-400 transition-colors line-clamp-2">
                    {deal.title ?? 'Sans titre'}
                  </Link>

                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-black text-white">{price.toFixed(1)}€</span>
                    {effectiveAvg && (
                      <span className="text-xs text-zinc-500">
                        Moy.{deal.model_market_avg ? ' modèle' : ''} {effectiveAvg.toFixed(0)}€
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {profit !== null && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Marge :</span>
                        <span className={`font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {profit >= 0 ? '+' : ''}{profit.toFixed(0)}€
                        </span>
                      </div>
                    )}
                    {confidence !== null && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500 flex items-center gap-1"><Sparkles size={10} /> Confiance IA :</span>
                        <span className={`font-bold ${confidence >= 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {Math.round(confidence * 100)}%
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-zinc-500">Verdict :</span>
                      <RecommendationBadge rec={deal.recommendation} />
                    </div>
                  </div>

                  {deal.reasoning && (
                    <p className="text-[10px] text-zinc-500 italic leading-relaxed border-t border-zinc-800 pt-2 line-clamp-3">
                      {deal.reasoning}
                    </p>
                  )}

                  {deal.scam_risk === 'medium' && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-400">
                      <AlertTriangle size={10} />Risque modéré — vérifiez l'annonce
                    </div>
                  )}

                  <div className="flex gap-2 pt-1 mt-auto">
                    <Link href={`/listings/${deal.listing_id}`} className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs py-2 rounded-xl font-medium border border-zinc-700/30 transition-colors">
                      Détails
                    </Link>
                    {deal.url && (
                      <a href={deal.url} target="_blank" rel="noopener noreferrer" className="bg-emerald-600 hover:bg-emerald-500 text-white p-2 rounded-xl transition-all flex items-center justify-center">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

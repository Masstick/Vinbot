'use client';
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, PricePoint } from '@/lib/api';
import { PriceChart } from '@/components/PriceChart';
import { ArrowLeft, ExternalLink, Calculator, DollarSign, Coins, TrendingDown, Tag, User, Calendar, Percent, ShieldCheck } from 'lucide-react';

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<any>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  // States pour la calculatrice d'arbitrage
  const [purchasePriceInput, setPurchasePriceInput] = useState<string>('');
  const [resalePriceInput, setResalePriceInput] = useState<string>('');
  const [shippingInput, setShippingInput] = useState<string>('');
  const [otherFeesInput, setOtherFeesInput] = useState<string>('0');

  useEffect(() => {
    const numId = parseInt(id);
    Promise.all([
      api.listings.get(numId),
      api.listings.history(numId),
    ])
      .then(([l, h]) => {
        setListing(l);
        setHistory(h);
        
        // Initialisation des données de la calculatrice
        if (l) {
          const lPrice = l.price ? String(l.price) : '0';
          setPurchasePriceInput(lPrice);
          
          const kl = l.keyword_listings?.[0];
          const marketAvgPrice = kl?.market_avg ? String(kl.market_avg) : String(Number(lPrice) * 1.4);
          setResalePriceInput(parseFloat(marketAvgPrice).toFixed(0));
          
          const shipping = kl?.keyword?.shipping_estimate ? String(kl.keyword.shipping_estimate) : '4';
          setShippingInput(shipping);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // Calculs dynamiques de l'arbitrage
  const calculations = useMemo(() => {
    const pPrice = parseFloat(purchasePriceInput) || 0;
    const rPrice = parseFloat(resalePriceInput) || 0;
    const ship = parseFloat(shippingInput) || 0;
    const other = parseFloat(otherFeesInput) || 0;

    // Protection acheteur Vinted standard : 0.70€ + 5% du prix de l'article
    const buyerProtection = pPrice > 0 ? 0.70 + pPrice * 0.05 : 0;
    
    // Coût total de l'acquisition
    const totalCost = pPrice + ship + buyerProtection + other;
    
    // Bénéfice net estimé
    const netProfit = rPrice - totalCost;
    
    // ROI = (bénéfice net / coût total) * 100
    const roi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;

    return {
      buyerProtection,
      totalCost,
      netProfit,
      roi
    };
  }, [purchasePriceInput, resalePriceInput, shippingInput, otherFeesInput]);

  if (loading) return <div className="text-center text-zinc-500 py-24 animate-pulse">Chargement des données d'arbitrage...</div>;
  if (!listing) return <div className="text-center text-zinc-500 py-24">Annonce introuvable ou supprimée.</div>;

  const kl = listing.keyword_listings?.[0];
  const marketAvg = kl?.market_avg ? parseFloat(String(kl.market_avg)) : null;
  const profit = kl?.potential_profit ? parseFloat(String(kl.potential_profit)) : null;
  const score = kl?.deal_score ? parseFloat(String(kl.deal_score)) : null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top back row */}
      <div className="flex items-center gap-3">
        <Link
          href="/opportunities"
          className="bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white p-2 rounded-xl border border-zinc-800 transition-colors"
          title="Retour aux opportunités"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white line-clamp-1">
            {listing.title ?? 'Annonce Vinted'}
          </h1>
          <p className="text-xs text-zinc-500">ID Vinted : {listing.vinted_id}</p>
        </div>
      </div>

      {/* Main double column */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Product preview & details */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden backdrop-blur-md">
            {/* Image section */}
            <div className="relative aspect-[4/3] bg-zinc-950">
              {listing.photo_url ? (
                <img src={listing.photo_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
                  Aucune photo disponible
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60" />
              
              {score !== null && (
                <span className="absolute top-4 right-4 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-xl text-xs font-bold backdrop-blur-md flex items-center gap-1 glow-emerald">
                  <TrendingDown size={14} />
                  -{score.toFixed(0)}% sous la moyenne
                </span>
              )}
            </div>

            {/* Core Specs Details */}
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-baseline">
                <span className="text-3xl font-black text-white">{listing.price?.toFixed(1)}€</span>
                {marketAvg && (
                  <span className="text-sm text-zinc-500">
                    Moyenne estimée : <strong className="text-zinc-300 font-semibold">{marketAvg.toFixed(0)}€</strong>
                  </span>
                )}
              </div>

              {/* Tag Badges */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {listing.brand && (
                  <span className="bg-zinc-800 text-zinc-300 px-2.5 py-1 rounded-lg text-xs font-medium border border-zinc-700/30">
                    {listing.brand}
                  </span>
                )}
                {listing.condition_label && (
                  <span className="bg-zinc-800/70 text-zinc-300 px-2.5 py-1 rounded-lg text-xs font-medium border border-zinc-800">
                    {listing.condition_label}
                  </span>
                )}
                {listing.size_label && (
                  <span className="bg-zinc-800/70 text-zinc-300 px-2.5 py-1 rounded-lg text-xs font-medium border border-zinc-800">
                    Taille : {listing.size_label}
                  </span>
                )}
              </div>

              {/* External Vinted Link button */}
              {listing.url && (
                <a
                  href={listing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl text-sm font-bold transition-all shadow-md glow-indigo flex items-center justify-center gap-2 mt-2"
                >
                  Ouvrir sur Vinted
                  <ExternalLink size={16} />
                </a>
              )}
            </div>

            {/* Seller / Time Metadata */}
            <div className="border-t border-zinc-850 p-5 bg-zinc-950/20 text-xs text-zinc-400 space-y-2.5">
              <div className="flex justify-between">
                <span className="text-zinc-650 flex items-center gap-1.5"><User size={13} /> Vendeur :</span>
                <span className="font-bold text-zinc-200">{listing.seller_name || 'Inconnu'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-650 flex items-center gap-1.5"><Calendar size={13} /> Détecté le :</span>
                <span className="font-bold text-zinc-200">
                  {new Date(listing.first_seen_at).toLocaleDateString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              {kl?.keyword && (
                <div className="flex justify-between">
                  <span className="text-zinc-650 flex items-center gap-1.5"><Tag size={13} /> Mot-clé associé :</span>
                  <span className="font-bold text-zinc-200 bg-zinc-800 px-2 py-0.5 rounded text-[10px]">
                    {kl.keyword.label}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Arbitrage Calculator & Markets */}
        <div className="lg:col-span-7 space-y-6">
          {/* Arbitrage Calculator Card */}
          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-5 backdrop-blur-md">
            <div className="flex items-center gap-2 pb-1 border-b border-zinc-850">
              <Calculator className="text-indigo-400 animate-pulse" size={20} />
              <h2 className="text-base font-bold text-white">Calculatrice d'arbitrage en direct</h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Prix d'achat */}
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                  Prix d'achat (€)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={purchasePriceInput}
                  onChange={e => setPurchasePriceInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Prix de revente estimé */}
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                  Prix de revente (€)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={resalePriceInput}
                  onChange={e => setResalePriceInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Frais de port */}
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                  Frais de port (€)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={shippingInput}
                  onChange={e => setShippingInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Autres frais */}
              <div>
                <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">
                  Frais annexes (€, nettoyage, etc.)
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={otherFeesInput}
                  onChange={e => setOtherFeesInput(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-xl px-4 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            {/* Calculations Breakdown */}
            <div className="bg-zinc-950/80 border border-zinc-850 rounded-xl p-4 space-y-3 text-xs text-zinc-400">
              <div className="flex justify-between items-center">
                <span>Protection acheteur Vinted (0.70€ + 5%) :</span>
                <span className="font-mono text-zinc-300">{calculations.buyerProtection.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Coût total d'acquisition (Investissement) :</span>
                <span className="font-mono text-zinc-300">{calculations.totalCost.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between items-center border-t border-zinc-850 pt-2.5">
                <span className="font-semibold text-zinc-300">Bénéfice net estimé :</span>
                <span className={`font-mono font-black text-sm ${calculations.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {calculations.netProfit >= 0 ? '+' : ''}{calculations.netProfit.toFixed(2)}€
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-zinc-300">Rendement de l'investissement (ROI) :</span>
                <span className={`font-mono font-black text-sm flex items-center gap-0.5 ${calculations.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  <Percent size={13} />
                  {calculations.roi.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Advice panel */}
            <div className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500 bg-zinc-950/20 p-3 rounded-xl border border-zinc-850">
              <ShieldCheck size={14} className="text-emerald-500 shrink-0 mt-0.5" />
              <span>
                <strong>Avis du bot :</strong> {calculations.roi >= 30 ? (
                  <span className="text-emerald-400">Excellent arbitrage ! Le ROI dépasse 30%, ce qui est idéal pour l'achat-revente rapide.</span>
                ) : calculations.roi >= 15 ? (
                  <span className="text-cyan-400">Arbitrage convenable. Rentabilité intermédiaire, convient pour des articles à rotation rapide.</span>
                ) : calculations.roi >= 0 ? (
                  <span className="text-amber-400">Marge faible. Assurez-vous qu'aucun autre frais ne s'ajoute avant de vous lancer.</span>
                ) : (
                  <span className="text-rose-400">Opération déficitaire. Ce deal n'est pas rentable avec ces estimations de coûts.</span>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row: Price Chart */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 space-y-4 backdrop-blur-md">
        <h2 className="text-base font-bold text-white">Suivi de l'évolution du prix</h2>
        <PriceChart history={history} marketAvg={marketAvg} />
      </div>
    </div>
  );
}

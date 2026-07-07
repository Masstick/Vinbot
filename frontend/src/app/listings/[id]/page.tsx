'use client';
import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, PricePoint } from '@/lib/api';
import { PriceChart } from '@/components/PriceChart';
import { ImageLightbox } from '@/components/ImageLightbox';
import { ArrowLeft, ExternalLink, Calculator, Tag, User, Calendar, Percent, ShieldCheck, ZoomIn } from 'lucide-react';

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [listing, setListing] = useState<any>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<{ description: string | null; photo_urls: string[] } | null>(null);
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);

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
          setResalePriceInput((Number(lPrice) * 1.4).toFixed(0));
          setShippingInput('4');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Description + galerie photo : récupérées à la demande (peut être lent, ne doit
    // pas bloquer l'affichage du reste de la fiche), donc en dehors du Promise.all ci-dessus.
    setDetails(null);
    api.listings.details(numId).then(setDetails).catch(() => {});
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

  const listingPrice = listing.price ? parseFloat(String(listing.price)) : null;
  const galleryUrls: string[] = details?.photo_urls?.length
    ? details.photo_urls
    : listing.photo_url
      ? [listing.photo_url]
      : [];
  const mainPhotoUrl = galleryUrls[0] ?? null;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Top back row */}
      <div className="flex items-center gap-3">
        <Link
          href="/listings"
          className="bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white p-2 rounded-xl border border-zinc-800 transition-colors"
          title="Retour aux annonces"
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
            <div className="relative aspect-[4/3] bg-zinc-950 group">
              {mainPhotoUrl ? (
                <button
                  type="button"
                  onClick={() => setZoomedUrl(mainPhotoUrl)}
                  className="w-full h-full block cursor-zoom-in"
                  aria-label="Zoomer sur la photo"
                >
                  <img src={mainPhotoUrl} alt="" className="w-full h-full object-cover" />
                  <span className="absolute bottom-2 right-2 bg-zinc-950/80 text-zinc-300 p-1.5 rounded-lg border border-zinc-800/80 opacity-0 group-hover:opacity-100 transition-opacity">
                    <ZoomIn size={14} />
                  </span>
                </button>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">
                  Aucune photo disponible
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent opacity-60 pointer-events-none" />
            </div>

            {/* Galerie miniatures — visible dès que d'autres photos ont été récupérées */}
            {galleryUrls.length > 1 && (
              <div className="flex gap-1.5 p-3 pb-0 overflow-x-auto">
                {galleryUrls.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setZoomedUrl(url)}
                    className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border transition-colors ${
                      url === mainPhotoUrl ? 'border-indigo-500' : 'border-zinc-800 hover:border-zinc-600'
                    }`}
                    aria-label={`Photo ${i + 1}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Description complète (récupérée à la demande) */}
            {details?.description && (
              <div className="px-5 pt-4">
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Description</p>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{details.description}</p>
              </div>
            )}

            {/* Core Specs Details */}
            <div className="p-5 space-y-4">
              <div className="flex justify-between items-baseline">
                <span className="text-3xl font-black text-white">{listingPrice?.toFixed(1)}€</span>
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
              {listing.keyword_listings?.[0]?.keyword?.label && (
                <div className="flex justify-between">
                  <span className="text-zinc-650 flex items-center gap-1.5"><Tag size={13} /> Mot-clé associé :</span>
                  <span className="font-bold text-zinc-200 bg-zinc-800 px-2 py-0.5 rounded text-[10px]">
                    {listing.keyword_listings[0].keyword.label}
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
        <PriceChart history={history} marketAvg={null} />
      </div>

      {zoomedUrl && <ImageLightbox url={zoomedUrl} onClose={() => setZoomedUrl(null)} />}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, InventoryRow } from '../../lib/api';

const STATUS_LABEL: Record<string, string> = { ONLINE: 'En ligne', RESERVED: 'Réservé', SOLD: 'Vendu', DELETED: 'Supprimé' };

export default function InventairePage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [category, setCategory] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    api.inventory.list({
      brand: brand || undefined,
      size: size || undefined,
      category: category || undefined,
      priceMin: priceMin ? Number(priceMin) : undefined,
      priceMax: priceMax ? Number(priceMax) : undefined,
    }).then(setRows).catch(() => {});
  }, [brand, size, category, priceMin, priceMax]);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setLoading(true);
    try { await api.inventory.sync(); load(); } finally { setLoading(false); }
  };

  const savePurchase = async (row: InventoryRow, value: string) => {
    if (row.product_id == null) return;
    const price = value === '' ? null : Number(value);
    await api.inventory.setPurchasePrice(row.product_id, price);
    load();
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-zinc-100">Inventaire</h1>
        <button onClick={sync} disabled={loading}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-2">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Rafraîchir
        </button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marque"
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Taille"
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Catégorie"
          className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="Prix min" type="number"
          className="w-24 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
        <input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="Prix max" type="number"
          className="w-24 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-100" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="text-left p-3">Article</th>
              <th className="text-left p-3">Marque</th>
              <th className="text-left p-3">Taille</th>
              <th className="text-right p-3">Prix</th>
              <th className="text-right p-3">Vues</th>
              <th className="text-right p-3">Favoris</th>
              <th className="text-right p-3">Prix d'achat</th>
              <th className="text-right p-3">Marge</th>
              <th className="text-left p-3">Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800/60 text-zinc-200">
                <td className="p-3 max-w-[260px] truncate">
                  {r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="hover:text-indigo-400">{r.vinted_id}</a> : r.vinted_id}
                </td>
                <td className="p-3">{r.brand ?? '—'}</td>
                <td className="p-3">{r.size_label ?? '—'}</td>
                <td className="p-3 text-right">{r.price != null ? `${r.price} €` : '—'}</td>
                <td className="p-3 text-right">{r.view_count ?? 0}</td>
                <td className="p-3 text-right">{r.favourite_count ?? 0}</td>
                <td className="p-3 text-right">
                  <input
                    type="number" step="0.01" defaultValue={r.purchase_price ?? ''}
                    onBlur={(e) => savePurchase(r, e.target.value)}
                    className="w-20 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-right text-zinc-100"
                  />
                </td>
                <td className={`p-3 text-right ${r.margin != null && r.margin >= 0 ? 'text-emerald-400' : r.margin != null ? 'text-red-400' : 'text-zinc-500'}`}>
                  {r.margin != null ? `${r.margin} €` : '—'}
                </td>
                <td className="p-3">{STATUS_LABEL[r.status] ?? r.status}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="p-8 text-center text-zinc-500">Aucun article. Connecte ton compte puis clique « Rafraîchir ».</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

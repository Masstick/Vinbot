'use client';
import { useEffect, useState } from 'react';
import { api, SaleRow } from '../../lib/api';

export default function VentesPage() {
  const [rows, setRows] = useState<SaleRow[]>([]);
  useEffect(() => { api.inventory.sales().then(setRows).catch(() => {}); }, []);

  return (
    <div className="p-4 lg:p-8">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Ventes</h1>
      <div className="overflow-x-auto rounded-2xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="text-left p-3">Acheteur</th>
              <th className="text-right p-3">Prix de vente</th>
              <th className="text-left p-3">Expédition</th>
              <th className="text-left p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-zinc-800/60 text-zinc-200">
                <td className="p-3">{s.buyer_name ?? '—'}</td>
                <td className="p-3 text-right">{s.sale_price != null ? `${s.sale_price} €` : '—'}</td>
                <td className="p-3">{s.shipping_status ?? '—'}</td>
                <td className="p-3">{s.sold_at ? new Date(s.sold_at).toLocaleDateString('fr-FR') : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="p-8 text-center text-zinc-500">Aucune vente synchronisée.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

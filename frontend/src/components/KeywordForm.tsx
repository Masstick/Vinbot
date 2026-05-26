'use client';
import { useState } from 'react';
import { Keyword, api } from '@/lib/api';
import { Plus, Check, AlertCircle, HelpCircle } from 'lucide-react';

interface Props {
  initial?: Partial<Keyword>;
  onSaved: (kw: Keyword) => void;
  onCancel: () => void;
}

export function KeywordForm({ initial, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    label: initial?.label ?? '',
    search_text: initial?.search_text ?? '',
    min_price: initial?.min_price ?? '',
    max_price: initial?.max_price ?? '',
    target_margin: initial?.target_margin ?? 10,
    shipping_estimate: initial?.shipping_estimate ?? 4,
    category: initial?.category ?? '',
    catalog_id: initial?.catalog_id ?? '',
    scan_interval_seconds: initial?.scan_interval_seconds ?? 120,
    active: initial?.active ?? true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        ...form,
        min_price: form.min_price === '' ? null : Number(form.min_price),
        max_price: form.max_price === '' ? null : Number(form.max_price),
        target_margin: Number(form.target_margin),
        shipping_estimate: Number(form.shipping_estimate),
        scan_interval_seconds: Number(form.scan_interval_seconds),
        category: form.category || null,
        catalog_id: form.catalog_id === '' ? null : Number(form.catalog_id),
      };
      const kw = initial?.id
        ? await api.keywords.update(initial.id, payload)
        : await api.keywords.create(payload);
      onSaved(kw);
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue lors de l\'enregistrement');
    } finally {
      setLoading(false);
    }
  }

  const fieldClass =
    'block w-full bg-zinc-950/60 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all';
  const labelClass = 'block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1.5 flex items-center gap-1';

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Nom du mot-clé */}
        <div>
          <label className={labelClass}>
            Nom du mot-clé <span className="text-rose-500">*</span>
          </label>
          <input
            className={fieldClass}
            value={form.label}
            onChange={e => set('label', e.target.value)}
            required
            placeholder="ex: iPhone 13 128Go"
          />
        </div>

        {/* Texte de recherche Vinted */}
        <div>
          <label className={labelClass}>
            Texte de recherche Vinted <span className="text-rose-500">*</span>
          </label>
          <input
            className={fieldClass}
            value={form.search_text}
            onChange={e => set('search_text', e.target.value)}
            required
            placeholder="ex: iphone 13 128go débloqué"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Marge cible */}
        <div>
          <label className={labelClass}>
            Marge cible (€)
          </label>
          <input
            className={fieldClass}
            type="number"
            step="0.5"
            min="0"
            value={form.target_margin}
            onChange={e => set('target_margin', e.target.value)}
          />
        </div>

        {/* Frais d'envoi */}
        <div>
          <label className={labelClass}>
            Frais envoi est. (€)
          </label>
          <input
            className={fieldClass}
            type="number"
            step="0.5"
            min="0"
            value={form.shipping_estimate}
            onChange={e => set('shipping_estimate', e.target.value)}
          />
        </div>

        {/* Prix min absolu */}
        <div>
          <label className={labelClass}>
            Prix min (€)
          </label>
          <input
            className={fieldClass}
            type="number"
            step="0.01"
            min="0"
            value={form.min_price}
            onChange={e => set('min_price', e.target.value)}
            placeholder="Optionnel"
          />
        </div>

        {/* Prix max absolu */}
        <div>
          <label className={labelClass}>
            Prix max (€)
          </label>
          <input
            className={fieldClass}
            type="number"
            step="0.01"
            min="0"
            value={form.max_price}
            onChange={e => set('max_price', e.target.value)}
            placeholder="Optionnel"
          />
        </div>

        {/* Intervalle de scrape */}
        <div className="col-span-2 md:col-span-1">
          <label className={labelClass}>
            Intervalle (s)
          </label>
          <input
            className={fieldClass}
            type="number"
            min="30"
            max="3600"
            value={form.scan_interval_seconds}
            onChange={e => set('scan_interval_seconds', e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        {/* Catégorie */}
        <div>
          <label className={labelClass}>Catégorie (label)</label>
          <input
            className={fieldClass}
            value={form.category}
            onChange={e => set('category', e.target.value)}
            placeholder="ex: Smartphones, Jeux vidéo…"
          />
        </div>

        {/* Catalog ID Vinted */}
        <div>
          <label className={labelClass}>
            ID catégorie Vinted
            <span title="Numéro dans l'URL Vinted, ex: /catalog/3599-cpus → 3599">
              <HelpCircle size={12} className="text-zinc-500" />
            </span>
          </label>
          <input
            className={fieldClass}
            type="number"
            min="1"
            value={form.catalog_id}
            onChange={e => set('catalog_id', e.target.value)}
            placeholder="ex: 3599"
          />
        </div>

        {/* Option Actif */}
        <div className="pt-5 flex items-center">
          <label className="relative flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => set('active', e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white peer-checked:after:border-white"></div>
            <span className="text-sm font-semibold text-zinc-300 peer-checked:text-zinc-200">
              Activer la surveillance (Scraper)
            </span>
          </label>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 p-3 rounded-xl">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3 pt-3">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl text-sm font-semibold transition-all shadow-md glow-indigo disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? 'Enregistrement…' : (
            <>
              {initial?.id ? 'Mettre à jour' : 'Créer le mot-clé'}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-zinc-800 hover:bg-zinc-800/80 text-zinc-400 hover:text-zinc-200 py-2.5 rounded-xl text-sm font-semibold transition-all"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

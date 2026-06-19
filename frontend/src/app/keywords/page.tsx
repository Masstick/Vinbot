'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, Keyword } from '@/lib/api';
import { KeywordForm } from '@/components/KeywordForm';
import { useCurrentUser } from '@/lib/CurrentUserContext';
import { Tags, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Radio, Search, Coins, Clock } from 'lucide-react';

export default function KeywordsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [editing, setEditing] = useState<Keyword | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const { activeUserId } = useCurrentUser();

  const load = useCallback(() => {
    if (activeUserId == null) {
      setKeywords([]);
      setLoading(false);
      return Promise.resolve();
    }
    return api.keywords.list(activeUserId).then(setKeywords).catch(() => {}).finally(() => setLoading(false));
  }, [activeUserId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(kw: Keyword) {
    await api.keywords.update(kw.id, { ...kw, active: !kw.active });
    load();
  }

  async function remove(id: number) {
    if (!confirm('Supprimer ce mot-clé et toutes ses annonces associées ?')) return;
    await api.keywords.delete(id);
    load();
  }

  function onSaved(kw: Keyword) {
    setCreating(false);
    setEditing(null);
    load();
  }

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight flex items-center gap-2">
            <Tags className="text-indigo-400" size={26} />
            Mots-clés surveillés
          </h1>
          <p className="text-sm text-zinc-400 mt-1">Gérez vos critères de recherche Vinted pour l'analyse en arrière-plan.</p>
        </div>
        {!creating && !editing && (
          <button
            onClick={() => setCreating(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md glow-indigo transition-colors flex items-center gap-1.5"
          >
            <Plus size={14} />
            Nouveau mot-clé
          </button>
        )}
      </div>

      {/* Editing or Creating Panel */}
      {(creating || editing) && (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 shadow-xl animate-fadeIn backdrop-blur-md">
          <h2 className="text-lg font-bold text-white mb-4">
            {editing ? `Modifier la recherche : ${editing.label}` : 'Nouveau critère de recherche'}
          </h2>
          <KeywordForm
            initial={editing ?? {}}
            onSaved={onSaved}
            onCancel={() => {
              setCreating(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      {/* Main List */}
      {loading ? (
        <div className="text-center text-zinc-500 py-16 animate-pulse">Chargement de la liste...</div>
      ) : keywords.length === 0 ? (
        <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-2xl p-16 text-center max-w-xl mx-auto space-y-4">
          <div className="bg-zinc-950 p-4 rounded-full inline-block border border-zinc-800">
            <Search size={32} className="text-zinc-600" />
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-zinc-200">Aucun mot-clé configuré</h3>
            <p className="text-xs text-zinc-500 max-w-xs mx-auto">
              Vous devez ajouter des mots-clés pour que le scraper puisse lancer les scans de prix sur Vinted.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-md glow-indigo transition-colors flex items-center gap-1.5 mx-auto"
          >
            <Plus size={14} />
            Créer ma première recherche
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {keywords.map(kw => (
            <div
              key={kw.id}
              className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-5 hover:border-zinc-700/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              {/* Left Details */}
              <div className="space-y-3 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-white text-base">{kw.label}</span>
                  {kw.category && (
                    <span className="text-[10px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded">
                      {kw.category}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 border ${
                      kw.active
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-zinc-800 text-zinc-500 border-zinc-700/40'
                    }`}
                  >
                    {kw.active ? (
                      <>
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                        </span>
                        Actif
                      </>
                    ) : (
                      'Inactif'
                    )}
                  </span>
                </div>

                <div className="text-xs text-zinc-500 flex items-center gap-2">
                  <span className="text-zinc-600 font-mono">Recherche :</span>
                  <code className="bg-zinc-950 px-2 py-1 rounded text-zinc-300 font-mono border border-zinc-900">
                    {kw.search_text}
                  </code>
                </div>

                {/* Parameters Grid */}
                <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1.5 text-xs text-zinc-400 font-medium">
                  {kw.min_price && (
                    <span className="flex items-center gap-1">
                      <Coins size={13} className="text-zinc-600" />
                      Prix min : <strong className="text-zinc-200">{kw.min_price}€</strong>
                    </span>
                  )}
                  {kw.max_price && (
                    <span className="flex items-center gap-1">
                      <Coins size={13} className="text-zinc-600" />
                      Prix max : <strong className="text-zinc-200">{kw.max_price}€</strong>
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Clock size={13} className="text-zinc-600" />
                    Intervalle : <strong className="text-zinc-200">{kw.scan_interval_seconds}s</strong>
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                <button
                  onClick={() => toggleActive(kw)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 ${
                    kw.active
                      ? 'border-zinc-800 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-300'
                      : 'border-indigo-500/20 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20'
                  }`}
                  title={kw.active ? 'Désactiver le scan' : 'Activer le scan'}
                >
                  {kw.active ? (
                    <>
                      <ToggleRight size={16} />
                      Suspendre
                    </>
                  ) : (
                    <>
                      <ToggleLeft size={16} />
                      Activer
                    </>
                  )}
                </button>
                <button
                  onClick={() => setEditing(kw)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors flex items-center gap-1.5"
                >
                  <Pencil size={13} />
                  Modifier
                </button>
                <button
                  onClick={() => remove(kw.id)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold border border-rose-500/20 bg-rose-500/5 text-rose-400 hover:bg-rose-500/15 transition-all flex items-center gap-1.5"
                >
                  <Trash2 size={13} />
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

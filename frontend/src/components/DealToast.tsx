'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { DealEvent, useDealsSocket } from '@/lib/useDealsSocket';
import { X, TrendingDown, ExternalLink, Bell } from 'lucide-react';

interface Toast extends DealEvent {
  id: string;
}

/**
 * Joue un son "cha-ching" synthétique via Web Audio API.
 * Aucune dépendance externe nécessaire.
 */
function playDealSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Petite mélodie ascendante style caisse enregistreuse
    const notes = [523, 659, 784, 1047]; // Do, Mi, Sol, Do (octave)
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = ctx.currentTime + i * 0.1;
      const end = start + 0.12;

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
      gain.gain.linearRampToValueAtTime(0, end);

      osc.start(start);
      osc.stop(end + 0.05);
    });
  } catch {
    // Navigateur sans Web Audio API — silencieux
  }
}

export function DealToastManager() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleDeal = useCallback((deal: DealEvent) => {
    const toast: Toast = { ...deal, id: `${deal.listingId}-${Date.now()}` };
    setToasts(prev => [toast, ...prev].slice(0, 5)); // max 5 toasts simultanés
    playDealSound();
  }, []);

  useDealsSocket(handleDeal);

  // Auto-dismiss après 12 secondes
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(0, -1));
    }, 12000);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-sm w-full pointer-events-none">
      {toasts.map(toast => (
        <DealToast key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

function DealToast({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const profitColor =
    toast.profit >= 30 ? 'text-emerald-400' : toast.profit >= 15 ? 'text-cyan-400' : 'text-amber-400';

  return (
    <div
      className="pointer-events-auto bg-zinc-900 border border-emerald-500/30 rounded-2xl shadow-2xl overflow-hidden animate-slideIn"
      style={{ animation: 'slideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)' }}
    >
      {/* Barre verte en haut */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-indigo-500" />

      <div className="p-4 flex gap-3">
        {/* Photo */}
        <div className="shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-zinc-800 border border-zinc-700/30">
          {toast.photoUrl ? (
            <img src={toast.photoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">
              <Bell size={20} />
            </div>
          )}
        </div>

        {/* Contenu */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded flex items-center gap-1">
                <TrendingDown size={10} />
                -{toast.dealScore.toFixed(0)}%
              </span>
              <span className="text-[10px] text-zinc-500 font-mono">{toast.keywordLabel}</span>
            </div>
            <button
              onClick={onClose}
              className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          {/* Titre */}
          <p className="text-xs font-semibold text-zinc-100 line-clamp-1">{toast.title}</p>

          {/* Prix */}
          <div className="flex items-baseline gap-2">
            <span className="text-base font-black text-white">{toast.price.toFixed(0)}€</span>
            <span className="text-[11px] text-zinc-500 line-through">Moy. {toast.marketAvg.toFixed(0)}€</span>
            <span className={`text-sm font-black ml-auto ${profitColor}`}>
              +{toast.profit.toFixed(0)}€
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Link
              href={`/listings/${toast.listingId}`}
              onClick={onClose}
              className="flex-1 text-center bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 py-1.5 rounded-lg transition-colors font-semibold border border-zinc-700/40"
            >
              Analyser
            </Link>
            {toast.url && (
              <a
                href={toast.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 rounded-lg transition-colors flex items-center"
              >
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

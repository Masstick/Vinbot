'use client';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../lib/api';

const NOVNC_URL = process.env.NEXT_PUBLIC_NOVNC_URL ?? '';

export function ConnectVintedModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [phase, setPhase] = useState<'loading' | 'waiting' | 'connected' | 'error'>('loading');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.accounts.connectStart()
      .then(() => { if (!cancelled) setPhase('waiting'); })
      .catch(() => { if (!cancelled) setPhase('error'); });

    pollRef.current = setInterval(async () => {
      try {
        const r = await api.accounts.connectPoll();
        if (r.connected) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase('connected');
          onConnected();
        }
      } catch { /* on continue de poller */ }
    }, 4000);

    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [onConnected]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="font-semibold text-zinc-100">Connecter Vinted</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-zinc-400 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-3">
          <p className="text-sm text-zinc-400 mb-2">
            {phase === 'connected'
              ? '✅ Compte connecté !'
              : 'Connecte-toi à Vinted dans la fenêtre ci-dessous (identifiants + 2FA). La connexion est détectée automatiquement.'}
          </p>
          <div className="aspect-[16/10] w-full bg-black rounded-lg overflow-hidden">
            {NOVNC_URL
              ? <iframe src={NOVNC_URL} className="w-full h-full border-0" title="Navigateur Vinted" />
              : <div className="text-zinc-500 text-sm p-4">NEXT_PUBLIC_NOVNC_URL non configurée.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

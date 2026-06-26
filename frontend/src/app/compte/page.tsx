'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plug, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, AccountStatusResp } from '../../lib/api';
import { ConnectVintedModal } from '../../components/ConnectVintedModal';

export default function ComptePage() {
  const [status, setStatus] = useState<AccountStatusResp | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => { api.accounts.status().then(setStatus).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const connected = status?.connected;
  const expired = status?.status === 'expired';

  return (
    <div className="p-4 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Compte Vinted</h1>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {connected ? <CheckCircle2 className="text-emerald-400" /> : expired ? <AlertTriangle className="text-amber-400" /> : <Plug className="text-zinc-500" />}
          <div>
            <p className="text-zinc-100 font-medium">
              {connected ? (status?.label ?? 'Compte connecté') : expired ? 'Session expirée' : 'Aucun compte connecté'}
            </p>
            <p className="text-xs text-zinc-500">
              {connected && status?.connected_at ? `Connecté le ${new Date(status.connected_at).toLocaleString('fr-FR')}` : 'Clique pour lier ton compte Vinted'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
        >
          {connected ? 'Reconnecter' : 'Connecter Vinted'}
        </button>
      </div>

      {open && (
        <ConnectVintedModal
          onClose={() => { setOpen(false); refresh(); }}
          onConnected={() => { refresh(); }}
        />
      )}
    </div>
  );
}

'use client';
import { ReactNode, useState } from 'react';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/lib/CurrentUserContext';
import { Bot, Plus, User as UserIcon, ChevronRight } from 'lucide-react';

export default function ProfileGate({ children }: { children: ReactNode }) {
  const { users, activeUserId, setActiveUserId, loading, refresh } = useCurrentUser();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [chatId, setChatId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) return null;
  if (activeUserId != null) return <>{children}</>;

  async function createUser() {
    if (!name.trim()) {
      setError('Le nom est requis.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const created = await api.users.create({ name: name.trim(), telegram_chat_id: chatId.trim() });
      await refresh();
      setActiveUserId(created.id);
    } catch {
      setError("Impossible de créer le profil. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] py-12 w-full">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="bg-indigo-600 p-3 rounded-2xl text-white glow-indigo inline-flex">
            <Bot size={28} className="animate-pulse" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">Bienvenue sur Vinbot</h1>
          <p className="text-sm text-zinc-400">
            {users.length > 0 ? 'Choisissez un profil pour continuer.' : 'Créez votre premier profil pour démarrer.'}
          </p>
        </div>

        {/* User cards */}
        {users.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {users.map(u => (
              <button
                key={u.id}
                onClick={() => setActiveUserId(u.id)}
                className="group flex items-center gap-4 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 text-left hover:border-indigo-500/40 hover:bg-zinc-900 transition-all duration-200"
              >
                <div className="bg-indigo-500/10 text-indigo-400 p-3 rounded-xl border border-indigo-500/20 shrink-0">
                  <UserIcon size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-white truncate">{u.name}</div>
                  <div className="text-xs text-zinc-500 font-mono truncate">
                    {u.telegram_chat_id ? `Telegram · ${u.telegram_chat_id}` : 'Pas de chat Telegram'}
                  </div>
                </div>
                <ChevronRight size={18} className="text-zinc-600 group-hover:text-indigo-400 transition-colors shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Create profile */}
        {creating || users.length === 0 ? (
          <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-4">
            <h2 className="text-sm font-bold text-zinc-200">Nouveau profil</h2>
            <div className="flex flex-col sm:flex-row items-stretch gap-3">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createUser()}
                placeholder="Nom"
                autoFocus
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white flex-1 focus:outline-none focus:border-indigo-500/50"
              />
              <input
                value={chatId}
                onChange={e => setChatId(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createUser()}
                placeholder="chat_id Telegram (optionnel)"
                className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-white flex-1 focus:outline-none focus:border-indigo-500/50"
              />
              <button
                onClick={createUser}
                disabled={saving}
                className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold glow-indigo transition-colors"
              >
                <Plus size={16} />
                Créer
              </button>
            </div>
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-3 rounded-xl bg-zinc-900/40 border border-dashed border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors"
          >
            <Plus size={14} />
            Nouveau profil
          </button>
        )}
      </div>
    </div>
  );
}

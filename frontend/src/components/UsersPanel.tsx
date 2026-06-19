'use client';
import { useState } from 'react';
import { Users, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { api, User } from '@/lib/api';
import { useCurrentUser } from '@/lib/CurrentUserContext';

export default function UsersPanel() {
  const { users, refresh, activeUserId, setActiveUserId } = useCurrentUser();
  const [name, setName] = useState('');
  const [chatId, setChatId] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editChatId, setEditChatId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function createUser() {
    if (!name.trim()) {
      setError('Le nom est requis.');
      return;
    }
    setError(null);
    const created = await api.users.create({ name: name.trim(), telegram_chat_id: chatId.trim() });
    setName('');
    setChatId('');
    await refresh();
    if (activeUserId == null) setActiveUserId(created.id);
  }

  function startEdit(u: User) {
    setEditingId(u.id);
    setEditName(u.name);
    setEditChatId(u.telegram_chat_id);
  }

  async function saveEdit(id: number) {
    await api.users.update(id, { name: editName.trim(), telegram_chat_id: editChatId.trim() });
    setEditingId(null);
    await refresh();
  }

  async function deleteUser(id: number) {
    await api.users.delete(id);
    await refresh();
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-6 space-y-5 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <div className="bg-violet-500/10 text-violet-400 p-2 rounded-xl border border-violet-500/20">
          <Users size={18} />
        </div>
        <div>
          <h2 className="font-bold text-white text-base">Utilisateurs</h2>
          <p className="text-xs text-zinc-500">Créez un profil par personne ; chacun reçoit ses alertes sur son propre chat Telegram.</p>
        </div>
      </div>

      <div className="space-y-2">
        {users.map(u => (
          <div key={u.id} className="flex items-center gap-2 bg-zinc-950/40 border border-zinc-850 rounded-xl px-3 py-2">
            {editingId === u.id ? (
              <>
                <input value={editName} onChange={e => setEditName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white flex-1" />
                <input value={editChatId} onChange={e => setEditChatId(e.target.value)} placeholder="chat_id" className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-white flex-1" />
                <button onClick={() => saveEdit(u.id)} className="text-emerald-400 hover:text-emerald-300"><Check size={16} /></button>
                <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300"><X size={16} /></button>
              </>
            ) : (
              <>
                <span className={`text-sm flex-1 ${u.id === activeUserId ? 'text-indigo-400 font-semibold' : 'text-zinc-200'}`}>{u.name}</span>
                <span className="text-[11px] text-zinc-500 font-mono">{u.telegram_chat_id || '—'}</span>
                <button onClick={() => startEdit(u)} className="text-zinc-500 hover:text-zinc-300"><Pencil size={14} /></button>
                <button onClick={() => deleteUser(u.id)} className="text-rose-500 hover:text-rose-400"><Trash2 size={14} /></button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-zinc-850">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nom" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-white flex-1" />
        <input value={chatId} onChange={e => setChatId(e.target.value)} placeholder="chat_id Telegram" className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-white flex-1" />
        <button onClick={createUser} className="bg-indigo-600 hover:bg-indigo-500 text-white p-1.5 rounded-lg"><Plus size={14} /></button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

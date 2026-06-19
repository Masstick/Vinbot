'use client';
import { useState } from 'react';
import { ChevronDown, User as UserIcon } from 'lucide-react';
import { useCurrentUser } from '@/lib/CurrentUserContext';

export default function UserPicker() {
  const { users, activeUser, setActiveUserId, loading } = useCurrentUser();
  const [open, setOpen] = useState(false);

  if (loading) {
    return <div className="text-xs text-zinc-500 px-3 py-2">Chargement…</div>;
  }

  return (
    <div className="relative px-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-700 transition-colors"
      >
        <span className="flex items-center gap-2 truncate">
          <UserIcon size={14} className="text-indigo-400 shrink-0" />
          <span className="truncate">{activeUser ? activeUser.name : 'Aucun profil'}</span>
        </span>
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-3 right-3 mt-1 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden">
          {users.length === 0 && (
            <div className="px-3 py-2 text-xs text-zinc-500">Aucun utilisateur — créez-en un dans Réglages.</div>
          )}
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => {
                setActiveUserId(u.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-800 transition-colors ${
                u.id === activeUser?.id ? 'text-indigo-400 font-semibold' : 'text-zinc-300'
              }`}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

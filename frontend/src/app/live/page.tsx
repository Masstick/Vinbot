'use client';
import { useCallback, useEffect, useState } from 'react';
import { useListingsSocket } from '@/lib/useListingsSocket';
import { ListingEvent } from '@/lib/listingEvent';
import { useCurrentUser } from '@/lib/CurrentUserContext';
import { Radio, ExternalLink } from 'lucide-react';

const MAX_ITEMS = 200;

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface ListingRowProps {
  listing: ListingEvent;
  receivedAt: string;
}

function ListingRow({ listing, receivedAt }: ListingRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/60 hover:bg-zinc-900/40 transition-colors group">
      {/* Thumbnail */}
      <div className="shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-zinc-800 border border-zinc-700/30">
        {listing.photoUrl ? (
          <img src={listing.photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-zinc-800" />
        )}
      </div>

      {/* Title */}
      <span className="flex-1 min-w-0 text-sm text-zinc-200 truncate font-medium">
        {listing.title}
      </span>

      {/* Keyword */}
      <span className="hidden sm:block shrink-0 text-[11px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-md">
        {listing.keywordLabel}
      </span>

      {/* Price */}
      <span className="shrink-0 text-sm font-black text-white w-14 text-right">
        {listing.price.toFixed(0)}€
      </span>

      {/* Received time */}
      <span className="shrink-0 text-[11px] text-zinc-600 font-mono w-16 text-right hidden md:block">
        {formatTime(receivedAt)}
      </span>

      {/* Link */}
      {listing.url ? (
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-zinc-600 hover:text-indigo-400 transition-colors"
          title="Voir sur Vinted"
        >
          <ExternalLink size={14} />
        </a>
      ) : (
        <span className="shrink-0 w-[14px]" />
      )}
    </div>
  );
}

export default function LivePage() {
  const [items, setItems] = useState<Array<ListingEvent & { receivedAt: string }>>([]);
  const [totalReceived, setTotalReceived] = useState(0);
  const [connected, setConnected] = useState(false);
  const { activeUserId } = useCurrentUser();

  const handleListing = useCallback((listing: ListingEvent) => {
    if (activeUserId != null && listing.userId !== activeUserId) return;
    setTotalReceived(n => n + 1);
    setItems(prev => [
      { ...listing, receivedAt: new Date().toISOString() },
      ...prev,
    ].slice(0, MAX_ITEMS));
  }, [activeUserId]);

  const socketRef = useListingsSocket(handleListing);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []); // socketRef.current is stable after mount

  const displayed = items;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-2">
            <Radio className="text-red-400" size={26} />
            Live
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Nouvelles annonces en temps réel — {totalReceived} reçue{totalReceived !== 1 ? 's' : ''} depuis l'ouverture
          </p>
        </div>

        {/* WS status */}
        <div className="flex items-center gap-2 text-xs">
          <span className={`relative flex h-2.5 w-2.5`}>
            {connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
          </span>
          <span className={connected ? 'text-emerald-400' : 'text-red-400'}>
            {connected ? 'Connecté' : 'Déconnecté'}
          </span>
        </div>
      </div>

      {/* Count */}
      <div className="flex items-center gap-3">
        <span className="ml-auto text-xs font-mono text-zinc-600">
          {displayed.length} / {MAX_ITEMS} affichée{displayed.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Feed */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl overflow-hidden">
        {/* Column headers */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 bg-zinc-950/40 text-[11px] font-semibold text-zinc-600 uppercase tracking-wider">
          <span className="w-9 shrink-0" />
          <span className="flex-1">Titre</span>
          <span className="hidden sm:block w-24 shrink-0">Mot-clé</span>
          <span className="w-14 shrink-0 text-right">Prix</span>
          <span className="hidden md:block w-16 shrink-0 text-right">Heure</span>
          <span className="w-[14px] shrink-0" />
        </div>

        {displayed.length === 0 ? (
          <div className="py-20 text-center space-y-3">
            <div className="inline-block p-4 rounded-full bg-zinc-950 border border-zinc-800">
              <Radio size={28} className="text-zinc-600 animate-pulse" />
            </div>
            <p className="text-sm text-zinc-500">
              En attente des nouvelles annonces…
            </p>
          </div>
        ) : (
          <div>
            {displayed.map((item, i) => (
              <ListingRow
                key={`${item.listingId}-${i}`}
                listing={item}
                receivedAt={item.receivedAt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

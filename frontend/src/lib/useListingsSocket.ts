'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ListingEvent, DealUpdatedEvent } from './listingEvent';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Hook qui se connecte au WebSocket backend et appelle onListing()
 * chaque fois qu'une nouvelle annonce est scrapée par le scraper, et
 * onDealUpdated() quand une classification différée (sweep Mistral) met
 * à jour le prix moyen/deal_score d'une annonce déjà affichée.
 */
export function useListingsSocket(
  onListing: (listing: ListingEvent) => void,
  onDealUpdated?: (update: DealUpdatedEvent) => void,
) {
  const socketRef = useRef<Socket | null>(null);
  const callbackRef = useRef(onListing);
  callbackRef.current = onListing;
  const dealUpdatedRef = useRef(onDealUpdated);
  dealUpdatedRef.current = onDealUpdated;

  useEffect(() => {
    const socket = io(API_URL, {
      transports: ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[VinBot WS] Connecté au serveur de listings');
    });

    socket.on('new-listing', (listing: ListingEvent) => {
      callbackRef.current(listing);
    });

    socket.on('deal-updated', (update: DealUpdatedEvent) => {
      dealUpdatedRef.current?.(update);
    });

    socket.on('disconnect', () => {
      console.log('[VinBot WS] Déconnecté');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return socketRef;
}

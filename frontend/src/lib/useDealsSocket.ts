'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export interface DealEvent {
  listingId: number;
  title: string;
  price: number;
  marketAvg: number;
  profit: number;
  dealScore: number;
  photoUrl: string | null;
  url: string | null;
  keywordLabel: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Hook qui se connecte au WebSocket backend et appelle onDeal()
 * chaque fois qu'un nouveau deal est détecté par le scraper.
 */
export function useDealsSocket(onDeal: (deal: DealEvent) => void) {
  const socketRef = useRef<Socket | null>(null);
  // Stocker le callback dans une ref pour éviter les reconnexions
  const callbackRef = useRef(onDeal);
  callbackRef.current = onDeal;

  useEffect(() => {
    const socket = io(API_URL, {
      transports: ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[VinBot WS] Connecté au serveur de deals');
    });

    socket.on('new-deal', (deal: DealEvent) => {
      callbackRef.current(deal);
    });

    socket.on('disconnect', () => {
      console.log('[VinBot WS] Déconnecté');
    });

    return () => {
      socket.disconnect();
    };
  }, []); // connexion unique au montage
}

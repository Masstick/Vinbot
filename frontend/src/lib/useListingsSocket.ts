'use client';
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { ListingEvent } from './listingEvent';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function useListingsSocket(onListing: (listing: ListingEvent) => void) {
  const socketRef = useRef<Socket | null>(null);
  const callbackRef = useRef(onListing);
  callbackRef.current = onListing;

  useEffect(() => {
    const socket = io(API_URL, {
      transports: ['websocket'],
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('new-listing', (listing: ListingEvent) => {
      callbackRef.current(listing);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return socketRef;
}

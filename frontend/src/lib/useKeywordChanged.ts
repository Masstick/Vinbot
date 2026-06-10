'use client';
import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Appelle onChanged() dès que le backend émet keyword-changed (ajout, modif, suppression). */
export function useKeywordChanged(onChanged: () => void) {
  const cbRef = useRef(onChanged);
  cbRef.current = onChanged;

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket'] });
    socket.on('keyword-changed', () => cbRef.current());
    return () => { socket.disconnect(); };
  }, []); // connexion stable, callback via ref
}

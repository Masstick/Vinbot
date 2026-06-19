'use client';
import { useEffect, useRef } from 'react';

/** Événement global déclenché par le pull-to-refresh (ou un bouton) pour recharger la page active. */
export const REFRESH_EVENT = 'vinbot:refresh';

export function emitRefresh() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REFRESH_EVENT));
}

/** Appelle cb() chaque fois qu'un refresh global est demandé. */
export function useRefreshSignal(cb: () => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    const handler = () => ref.current();
    window.addEventListener(REFRESH_EVENT, handler);
    return () => window.removeEventListener(REFRESH_EVENT, handler);
  }, []);
}

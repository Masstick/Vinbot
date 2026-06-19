'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { emitRefresh } from '@/lib/refreshEvent';

const THRESHOLD = 70; // distance (px) à dépasser pour déclencher
const MAX = 110; // distance max affichée

/**
 * Pull-to-refresh tactile (mobile). Quand on tire vers le bas en haut de page,
 * émet l'événement global de refresh ; les pages écoutent via useRefreshSignal.
 */
export default function PullToRefresh({ children }: { children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(false); // doigt en cours de drag → pas de transition
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    const setP = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };

    const onStart = (e: TouchEvent) => {
      if (busyRef.current || window.scrollY > 0) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current == null || busyRef.current) return;
      if (window.scrollY > 0) {
        startY.current = null;
        setActive(false);
        setP(0);
        return;
      }
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setP(0);
        return;
      }
      setActive(true);
      setP(Math.min(MAX, delta * 0.5)); // résistance
      e.preventDefault();
    };

    const finish = () => {
      if (startY.current == null) return;
      startY.current = null;
      setActive(false);
      if (pullRef.current >= THRESHOLD) {
        busyRef.current = true;
        setRefreshing(true);
        setP(THRESHOLD);
        emitRefresh();
        window.setTimeout(() => {
          busyRef.current = false;
          setRefreshing(false);
          setP(0);
        }, 900);
      } else {
        setP(0);
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', finish, { passive: true });
    window.addEventListener('touchcancel', finish, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', finish);
      window.removeEventListener('touchcancel', finish);
    };
  }, []);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(1, pull / THRESHOLD);
  const transition = active ? 'none' : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

  return (
    <>
      {/* Indicateur (mobile uniquement) */}
      <div
        className="fixed top-0 left-0 right-0 z-50 flex justify-center pointer-events-none lg:hidden"
        style={{
          transform: `translateY(${visible ? pull : -48}px)`,
          opacity: visible ? 1 : 0,
          transition: active ? 'opacity 0.2s' : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s',
        }}
      >
        <div className="mt-3 bg-zinc-900 border border-zinc-800 rounded-full p-2.5 shadow-lg">
          <RefreshCw
            size={18}
            className={`text-indigo-400 ${refreshing ? 'animate-spin' : ''}`}
            style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
          />
        </div>
      </div>

      {/* Contenu translaté pendant le pull */}
      <div style={{ transform: pull > 0 ? `translateY(${pull}px)` : undefined, transition }}>
        {children}
      </div>
    </>
  );
}

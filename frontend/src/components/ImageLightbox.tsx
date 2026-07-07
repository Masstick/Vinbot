'use client';
import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut } from 'lucide-react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_CLICK_SCALE = 2.5;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

interface Props {
  url: string;
  onClose: () => void;
}

/**
 * Lightbox plein écran avec zoom/pan : molette (ou pincement trackpad) pour zoomer,
 * glisser pour se déplacer dans l'image une fois zoomée, double-clic/double-tap
 * pour zoomer/dézoomer d'un cran. Pas de dépendance externe — juste des transforms
 * CSS pilotés par les Pointer Events (mouse + tactile en un seul code path).
 */
export function ImageLightbox({ url, onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Repart de zéro à chaque nouvelle photo (changer de miniature sans fermer le lightbox).
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [url]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function zoomBy(factor: number) {
    setScale(s => {
      const next = clampScale(s * factor);
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 });
      return next;
    });
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.0015));
  }

  function handleDoubleClick() {
    if (scale > MIN_SCALE) {
      setScale(MIN_SCALE);
      setOffset({ x: 0, y: 0 });
    } else {
      setScale(DOUBLE_CLICK_SCALE);
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (scale <= MIN_SCALE) return;
    imgRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / scale;
    const dy = (e.clientY - dragRef.current.y) / scale;
    setOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
  }

  function handlePointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    imgRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6 cursor-zoom-out overflow-hidden"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 p-2 rounded-xl border border-zinc-700/60 transition-colors"
        aria-label="Fermer"
      >
        <X size={18} />
      </button>

      <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            zoomBy(1 / 1.4);
          }}
          className="bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 p-2 rounded-xl border border-zinc-700/60 transition-colors disabled:opacity-30"
          disabled={scale <= MIN_SCALE}
          aria-label="Dézoomer"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            zoomBy(1.4);
          }}
          className="bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 p-2 rounded-xl border border-zinc-700/60 transition-colors disabled:opacity-30"
          disabled={scale >= MAX_SCALE}
          aria-label="Zoomer"
        >
          <ZoomIn size={16} />
        </button>
        {scale > MIN_SCALE && (
          <span className="text-[11px] font-mono text-zinc-400 bg-zinc-900/80 border border-zinc-700/60 rounded-lg px-2 py-1">
            {scale.toFixed(1)}×
          </span>
        )}
      </div>

      <img
        ref={imgRef}
        src={url}
        alt=""
        draggable={false}
        onClick={e => e.stopPropagation()}
        onWheel={handleWheel}
        onDoubleClick={e => {
          e.stopPropagation();
          handleDoubleClick();
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          transform: `scale(${scale}) translate(${offset.x}px, ${offset.y}px)`,
          transition: dragRef.current ? 'none' : 'transform 0.1s ease-out',
          touchAction: 'none',
          cursor: scale > MIN_SCALE ? 'grab' : 'zoom-in',
        }}
        className="max-w-full max-h-full object-contain rounded-lg select-none"
      />
    </div>
  );
}

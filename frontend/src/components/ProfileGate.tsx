'use client';
import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/CurrentUserContext';
import { AlertCircle } from 'lucide-react';

export default function ProfileGate({ children }: { children: ReactNode }) {
  const { activeUserId, loading } = useCurrentUser();
  const pathname = usePathname();

  if (loading) return null;

  if (activeUserId == null && pathname !== '/settings') {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center gap-3">
        <AlertCircle size={28} className="text-amber-400" />
        <p className="text-sm text-zinc-300 font-semibold">Sélectionnez ou créez un profil pour continuer</p>
        <p className="text-xs text-zinc-500">Rendez-vous dans Réglages pour créer votre premier profil.</p>
      </div>
    );
  }

  return <>{children}</>;
}

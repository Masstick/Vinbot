'use client';
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api, User } from './api';

const STORAGE_KEY = 'vinbot_active_user_id';

interface CurrentUserState {
  users: User[];
  activeUserId: number | null;
  activeUser: User | null;
  setActiveUserId: (id: number) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserState | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [activeUserId, setActiveUserIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.users.list();
      setUsers(list);
      const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      const storedId = stored ? Number(stored) : null;
      const validStored = storedId != null && list.some(u => u.id === storedId);
      setActiveUserIdState(validStored ? storedId : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setActiveUserId = useCallback((id: number) => {
    setActiveUserIdState(id);
    if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const activeUser = users.find(u => u.id === activeUserId) ?? null;

  return (
    <CurrentUserContext.Provider value={{ users, activeUserId, activeUser, setActiveUserId, loading, refresh }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserState {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser must be used within a CurrentUserProvider');
  return ctx;
}

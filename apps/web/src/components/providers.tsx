'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import type { User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '../lib/supabase/client';
import { ApiClient, apiBaseUrl } from '../lib/api/client';
import { ToastProvider } from './ui/toast';

interface SessionContextValue {
  user: User;
  getAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ user, children }: { user: User; children: ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      tokenRef.current = session?.access_token ?? null;
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        router.replace(`/${locale}/login`);
        router.refresh();
      }
    });
    return () => subscription.unsubscribe();
  }, [router, locale]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    tokenRef.current = session?.access_token ?? null;
    return tokenRef.current;
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace(`/${locale}/login`);
    router.refresh();
  }, [router, locale]);

  const value = useMemo(() => ({ user, getAccessToken, signOut }), [user, getAccessToken, signOut]);

  return (
    <SessionContext.Provider value={value}>
      <ToastProvider>{children}</ToastProvider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider.');
  return context;
}

export interface CurrentStore {
  id: string;
  name: string;
  role: string;
}

const StoreContext = createContext<CurrentStore | null>(null);

export function StoreProvider({ store, children }: { store: CurrentStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): CurrentStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used within StoreProvider.');
  return store;
}

/** Typed API client bound to the current session + store. */
export function useApi(): ApiClient {
  const { getAccessToken, signOut } = useSession();
  const router = useRouter();
  const locale = useLocale();

  return useMemo(
    () =>
      new ApiClient({
        baseUrl: apiBaseUrl(),
        getAccessToken,
        onUnauthorized: () => {
          void signOut();
          router.replace(`/${locale}/login`);
        },
      }),
    [getAccessToken, signOut, router, locale],
  );
}

export function useTenantPath(): (suffix: string) => string {
  const store = useStore();
  return useCallback((suffix: string) => `/tenants/${store.id}${suffix}`, [store.id]);
}

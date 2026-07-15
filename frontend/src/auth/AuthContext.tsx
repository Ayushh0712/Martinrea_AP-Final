'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  AUTH_COOKIE,
  STORAGE_KEYS,
  deleteCookie,
  getCookie,
  readJSON,
  remove,
  setAuthCookie,
  writeJSON,
} from '@/lib/storage';
import { authApi, registerUnauthorizedHandler } from '@/lib/api';
import type { AuthUser } from '@/types/user';

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Start empty so the server-rendered markup matches the first client render
  // (no hydration mismatch). Real values are hydrated from the cookie /
  // localStorage in the mount effect below.
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  const router = useRouter();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    deleteCookie(AUTH_COOKIE);
    remove(STORAGE_KEYS.authUser);
    router.replace('/login');
  }, [router]);

  // Register global 401 handler so the axios interceptor can boot the user.
  useEffect(() => {
    registerUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      router.replace('/login');
    });
  }, [router]);

  // Hydrate auth state on mount (client only). If a token cookie exists, trust
  // the cached user for an instant paint, then refresh it from `/users/me`.
  useEffect(() => {
    const existing = getCookie(AUTH_COOKIE);
    if (!existing) {
      setIsInitializing(false);
      return;
    }
    setToken(existing);
    const cachedUser = readJSON<AuthUser | null>(STORAGE_KEYS.authUser, null);
    if (cachedUser) setUser(cachedUser);

    let cancelled = false;
    authApi
      .me()
      .then((fresh) => {
        if (cancelled) return;
        setUser(fresh);
        writeJSON(STORAGE_KEYS.authUser, fresh);
      })
      .catch(() => {
        /* axios interceptor handles 401 */
      })
      .finally(() => {
        if (!cancelled) setIsInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthUser> => {
      const res = await authApi.login(email, password);
      setToken(res.accessToken);
      setUser(res.user);
      setAuthCookie(res.accessToken);
      writeJSON(STORAGE_KEYS.authUser, res.user);
      return res.user;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: !!token && !!user,
      isInitializing,
      login,
      logout,
    }),
    [user, token, isInitializing, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

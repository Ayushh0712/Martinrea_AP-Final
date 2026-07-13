import { useContext } from 'react';
import { AuthContext } from './AuthContext';
import type { Role } from '@/types/user';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

export function useHasRole(...roles: Role[]) {
  const { user } = useAuth();
  if (!user) return false;
  return roles.includes(user.role);
}

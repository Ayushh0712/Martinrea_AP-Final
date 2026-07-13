'use client';

import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { AuthProvider } from '@/auth/AuthContext';
import { queryClient } from '@/lib/query-client';

/**
 * Client-side provider tree. Mirrors the old `App.tsx` wrapper: React Query +
 * Radix tooltips + auth context, with the toast portal mounted alongside.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <AuthProvider>{children}</AuthProvider>
      </TooltipProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

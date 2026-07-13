'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { useAuth } from '@/auth/useAuth';
import { canAccessPath } from '@/components/layout/nav-items';

/**
 * Protected application shell. Folds together the old `ProtectedRoute`
 * (auth gate + loading state), `RoleGate` (role-based access), and `AppShell`
 * (sidebar + topbar) into a single App Router layout.
 *
 * `middleware.ts` already blocks unauthenticated requests server-side; the
 * client checks here cover the initializing window and in-app navigations,
 * and enforce role-based access using the fetched user record.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { user, isAuthenticated, isInitializing } = useAuth();

  const allowed = isAuthenticated && canAccessPath(pathname, user?.role);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Bounce unauthenticated users to login (belt-and-suspenders with middleware).
  useEffect(() => {
    if (!isInitializing && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isInitializing, isAuthenticated, router]);

  // Role gate: send users to the dashboard if their role can't access the path.
  useEffect(() => {
    if (!isInitializing && isAuthenticated && !allowed) {
      router.replace('/dashboard');
    }
  }, [isInitializing, isAuthenticated, allowed, router]);

  if (isInitializing || !isAuthenticated || !allowed) {
    return (
      <div className="flex h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-sm text-ink-muted">Loading workspace…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile backdrop — only rendered while the drawer is open below lg. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="lg:pl-[220px]">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
    </div>
  );
}

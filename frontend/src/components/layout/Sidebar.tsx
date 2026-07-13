'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Lock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { visibleSections } from './nav-items';
import { useAuth } from '@/auth/useAuth';
import { profileFor } from '@/lib/permissions';

interface SidebarProps {
  /** Mobile drawer open state. Ignored at lg+ where the sidebar is always shown. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const { user } = useAuth();
  const pathname = usePathname() ?? '';
  const profile = profileFor(user?.role);
  const sections = visibleSections(user?.role);

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col bg-sidebar text-white transition-transform duration-200 ease-out lg:z-30 lg:translate-x-0',
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
      )}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1 shadow-sm ring-1 ring-black/5">
          <img
            src="/martinrea-logo.png"
            alt="Martinrea"
            className="h-full w-full object-contain"
          />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">
            Martinrea
          </span>
          <span className="text-[10.5px] uppercase tracking-[0.13em] text-sidebar-muted">
            Automation Suite
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-sidebar-muted hover:bg-sidebar-hover hover:text-white lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.heading} className="mb-5">
            <h4 className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-sidebar-muted">
              {section.heading}
            </h4>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.to ||
                  pathname.startsWith(`${item.to}/`);

                // Locked items (out of Phase 1 scope per PRD §7.3) render as a
                // non-interactive row with a lock affordance — no navigation.
                if (item.locked) {
                  return (
                    <li key={item.to}>
                      <div
                        role="link"
                        aria-disabled="true"
                        title="Out of Phase 1 scope"
                        className={cn(
                          'flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium',
                          'bg-black/25 text-slate-400/70',
                        )}
                      >
                        <item.icon
                          className="h-4 w-4 shrink-0 opacity-60"
                          strokeWidth={1.8}
                        />
                        <span className="truncate">{item.label}</span>
                        <Lock
                          className="ml-auto h-3.5 w-3.5 shrink-0 text-slate-400/80"
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={item.to}>
                    <Link
                      href={item.to}
                      onClick={() => onClose?.()}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors',
                        'text-slate-200/85 hover:bg-sidebar-hover hover:text-white',
                        isActive &&
                          'bg-brand-400 text-white shadow-sm hover:bg-brand-300 hover:text-white',
                      )}
                    >
                      <item.icon
                        className="h-4 w-4 shrink-0 opacity-90"
                        strokeWidth={1.8}
                      />
                      <span className="truncate">{item.label}</span>
                      {!item.available && (
                        <span className="ml-auto rounded-sm bg-white/5 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-sidebar-muted">
                          soon
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        {profile ? (
          <div className="rounded-lg bg-sidebar-hover/60 p-3">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-md',
                  profile.pillClass,
                )}
              >
                <profile.icon className="h-3.5 w-3.5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-white">
                  {profile.label}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-sidebar-hover/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">
              Phase 1 build
            </p>
            <p className="mt-1 text-[12px] text-slate-300">
              Workflow & approvals core. More modules ship next.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

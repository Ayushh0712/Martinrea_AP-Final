'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  ScanLine,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { useInvoicesList } from '@/hooks/useInvoices';
import { canAccessPath } from '@/components/layout/nav-items';
import { readJSON, writeJSON, STORAGE_KEYS } from '@/lib/storage';
import type { InvoiceStatus } from '@/types/invoice';

interface Note {
  icon: LucideIcon;
  iconClass: string;
  text: string;
  to: string;
  status: InvoiceStatus;
}

export function NotificationsMenu() {
  const router = useRouter();
  const { user } = useAuth();
  const { invoices } = useInvoicesList();
  const canViewInvoiceList = canAccessPath('/invoices', user?.role);

  // Dismissed ("read") statuses. Initialised empty to match SSR, then hydrated
  // from localStorage after mount to avoid a hydration mismatch.
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    setDismissed(readJSON<string[]>(STORAGE_KEYS.notificationsRead, []));
  }, []);

  // Reset-on-zero: once a category empties, drop its "read" flag so the
  // notification can reappear if new items arrive later.
  useEffect(() => {
    setDismissed((prev) => {
      const next = prev.filter((s) => invoices.some((i) => i.status === s));
      if (next.length === prev.length) return prev;
      writeJSON(STORAGE_KEYS.notificationsRead, next);
      return next;
    });
  }, [invoices]);

  function markAsRead(status: string) {
    setDismissed((prev) => {
      if (prev.includes(status)) return prev;
      const next = [...prev, status];
      writeJSON(STORAGE_KEYS.notificationsRead, next);
      return next;
    });
  }

  const notes = useMemo<Note[]>(() => {
    const count = (s: InvoiceStatus) => invoices.filter((i) => i.status === s).length;
    const plural = (n: number) => (n === 1 ? '' : 's');
    const out: Note[] = [];

    const approval = count('PENDING_APPROVAL');
    if (approval > 0)
      out.push({
        icon: Clock,
        iconClass: 'bg-yellow-50 text-yellow-700',
        text: `${approval} invoice${plural(approval)} awaiting approval`,
        // Approve-only roles can't open the invoice list; send them to
        // their approval queue instead.
        to: canViewInvoiceList ? '/invoices?status=PENDING_APPROVAL' : '/approvals',
        status: 'PENDING_APPROVAL',
      });

    const review = count('PENDING_REVIEW');
    if (review > 0)
      out.push({
        icon: ScanLine,
        iconClass: 'bg-sky-50 text-sky-700',
        text: `${review} invoice${plural(review)} to review`,
        to: '/invoices?status=PENDING_REVIEW',
        status: 'PENDING_REVIEW',
      });

    const exceptions = count('EXCEPTION');
    if (exceptions > 0)
      out.push({
        icon: AlertTriangle,
        iconClass: 'bg-rose-50 text-rose-600',
        text: `${exceptions} exception${plural(exceptions)} to resolve`,
        to: '/invoices?status=EXCEPTION',
        status: 'EXCEPTION',
      });

    // Drop notes whose destination this role can't open (e.g. review /
    // exception queues live under /invoices, which is clerk-only).
    return out.filter(
      (n) =>
        !dismissed.includes(n.status) &&
        canAccessPath(n.to.split('?')[0], user?.role),
    );
  }, [invoices, dismissed, canViewInvoiceList, user?.role]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-[18px] w-[18px] text-ink-muted" />
          {notes.length > 0 && (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {notes.length > 0 && (
            <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand">
              {notes.length}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {notes.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" />
            <p className="mt-2 text-[13px] font-medium text-ink">You're all caught up</p>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              No items need your attention right now.
            </p>
          </div>
        ) : (
          notes.map((n) => (
            <DropdownMenuItem
              key={n.to}
              onSelect={() => router.push(n.to)}
              className="gap-2.5 py-2.5"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${n.iconClass}`}
              >
                <n.icon className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 text-[13px] text-ink">{n.text}</span>
              <button
                type="button"
                aria-label="Mark as read"
                title="Mark as read"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  markAsRead(n.status);
                }}
                className="shrink-0 rounded p-1 text-ink-subtle transition hover:bg-emerald-50 hover:text-emerald-600"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuItem>
          ))
        )}

        {canViewInvoiceList && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/invoices')} className="justify-center text-[12.5px] font-medium text-brand">
              View all invoices
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

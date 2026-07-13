'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  DollarSign,
  FileWarning,
  Inbox,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/invoices/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { useInvoicesList } from '@/hooks/useInvoices';
import { useAuth } from '@/auth/useAuth';
import { formatCurrency, relativeFromNow } from '@/lib/utils';
import { PIPELINE_ORDER, STATUS_META } from '@/lib/constants';
import { EmptyInvoicesState } from '@/components/invoices/EmptyInvoicesState';
import { canAccessPath } from '@/components/layout/nav-items';
import { profileFor } from '@/lib/permissions';
import type { Invoice, InvoiceStatus } from '@/types/invoice';

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { invoices: allInvoices, isEmpty, isLoading } = useInvoicesList();

  // REJECTED invoices are database-only records; keep them out of every
  // dashboard stat, chart and list.
  const invoices = useMemo(
    () => allInvoices.filter((i) => i.status !== 'REJECTED'),
    [allInvoices],
  );

  const stats = useMemo(() => {
    const total = invoices.length;
    const pendingApproval = invoices.filter(
      (i) => i.status === 'PENDING_APPROVAL',
    ).length;
    const exceptions = invoices.filter((i) => i.status === 'EXCEPTION').length;
    const approved = invoices.filter((i) => i.status === 'APPROVED').length;

    const totalValueApproved = invoices
      .filter((i) => i.status === 'APPROVED')
      .reduce((sum, i) => sum + Number(i.totalAmount), 0);

    const totalValueOutstanding = invoices
      .filter(
        (i) =>
          i.status !== 'APPROVED' &&
          i.status !== 'REJECTED' &&
          i.status !== 'EXCEPTION',
      )
      .reduce((sum, i) => sum + Number(i.totalAmount), 0);

    return {
      total,
      pendingApproval,
      exceptions,
      approved,
      totalValueApproved,
      totalValueOutstanding,
    };
  }, [invoices]);

  const statusBreakdown = useMemo(() => {
    const counts = new Map<InvoiceStatus, number>();
    for (const inv of invoices) {
      counts.set(inv.status, (counts.get(inv.status) ?? 0) + 1);
    }
    const order: InvoiceStatus[] = [...PIPELINE_ORDER, 'EXCEPTION'];
    return order.map((status) => ({
      status,
      label: STATUS_META[status].short,
      count: counts.get(status) ?? 0,
      color: STATUS_META[status].color,
    }));
  }, [invoices]);

  const myQueue = useMemo(() => {
    if (!user) return [];
    return invoices
      .filter((i) => i.currentApproverId === user.id)
      .slice(0, 6);
  }, [invoices, user]);

  const recentInvoices = useMemo(() => invoices.slice(0, 8), [invoices]);

  const profile = profileFor(user?.role);
  const canViewInvoiceList = canAccessPath('/invoices', user?.role);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-ink">
            Good day.
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {profile?.tagline ??
              "Here's what's moving through Accounts Payable right now."}
          </p>
        </div>
        {canViewInvoiceList && (
          <Button asChild variant="secondary" size="sm">
            <Link href="/invoices">
              View all invoices
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="Open invoices"
          value={stats.total - stats.approved - stats.exceptions}
          icon={Inbox}
          iconClass="bg-brand-50 text-brand"
          loading={isLoading}
          sub={`${stats.total} total tracked`}
        />
        <KpiTile
          label="Awaiting approval"
          value={stats.pendingApproval}
          icon={Clock}
          iconClass="bg-yellow-50 text-yellow-700"
          loading={isLoading}
          sub="48h SLA"
        />
        <KpiTile
          label="Exceptions"
          value={stats.exceptions}
          icon={FileWarning}
          iconClass="bg-rose-50 text-rose-600"
          loading={isLoading}
          sub="Need clerk review"
        />
        <KpiTile
          label="Approved value"
          value={formatCurrency(stats.totalValueApproved)}
          icon={DollarSign}
          iconClass="bg-emerald-50 text-emerald-600"
          loading={isLoading}
          sub={`${formatCurrency(stats.totalValueOutstanding)} outstanding`}
          isCurrency
        />
      </div>

      {/* Main grid */}
      {isEmpty ? (
        <EmptyInvoicesState />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
          {/* Chart + Recent */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Invoice pipeline</CardTitle>
                  <p className="mt-1 text-sm text-ink-muted">
                    Count of invoices in each lifecycle state.
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[12px] text-emerald-700">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {stats.approved} approved
                </div>
              </CardHeader>
              <CardContent className="h-[260px] pr-2">
                {isLoading ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={statusBreakdown}
                      margin={{ top: 8, right: 10, bottom: 0, left: -16 }}
                    >
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#5A6776' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: '#5A6776' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RechartsTooltip
                        cursor={{ fill: 'rgba(0, 51, 100, 0.05)' }}
                        contentStyle={{
                          borderRadius: 8,
                          border: '1px solid #E5E9F0',
                          fontSize: 12,
                          boxShadow:
                            '0 4px 12px rgba(15, 25, 35, 0.06), 0 2px 4px rgba(15, 25, 35, 0.04)',
                        }}
                        formatter={(v: number) => [v, 'invoices']}
                      />
                      <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                        {statusBreakdown.map((entry) => (
                          <Cell
                            key={entry.status}
                            fill={entry.color}
                            opacity={entry.count === 0 ? 0.25 : 1}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Recent invoices</CardTitle>
                  <p className="mt-1 text-sm text-ink-muted">
                    Latest activity across all plants.
                  </p>
                </div>
                {canViewInvoiceList && (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/invoices">View all</Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent className="-mt-2 px-0">
                <div className="divide-y divide-line border-y border-line">
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3 px-6 py-3">
                          <Skeleton className="h-9 w-9 rounded-md" />
                          <div className="flex-1 space-y-1.5">
                            <Skeleton className="h-3 w-1/3" />
                            <Skeleton className="h-3 w-1/2" />
                          </div>
                          <Skeleton className="h-5 w-16" />
                        </div>
                      ))
                    : recentInvoices.map((inv) => (
                        <InvoiceRow key={inv.id} invoice={inv} onClick={() => router.push(`/invoices/${inv.id}`)} />
                      ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* My queue */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" />
                  My approval queue
                </CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  Invoices currently routed to you.
                </p>
              </CardHeader>
              <CardContent className="px-0">
                {myQueue.length === 0 ? (
                  <div className="px-6 py-8 text-center">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
                    <p className="mt-2 text-sm font-medium text-ink">
                      You're all caught up
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      Nothing routed to you right now.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-line border-y border-line">
                    {myQueue.map((inv) => (
                      <button
                        key={inv.id}
                        onClick={() => router.push(`/invoices/${inv.id}`)}
                        className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-canvas"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-[13.5px] font-semibold text-ink">
                            {inv.invoiceNumber}
                          </p>
                          <p className="truncate text-[12px] text-ink-muted">
                            {inv.supplierName} · {formatCurrency(Number(inv.totalAmount), inv.currency)}
                          </p>
                        </div>
                        <StatusBadge status={inv.status} size="sm" />
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status legend</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2.5">
                {statusBreakdown.map((s) => (
                  <div key={s.status} className="flex items-center gap-2 text-[12.5px]">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-ink-muted">{STATUS_META[s.status].label}</span>
                    <span className="ml-auto font-semibold text-ink">
                      {s.count}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

interface KpiProps {
  label: string;
  value: number | string;
  sub?: string;
  icon: typeof Inbox;
  iconClass?: string;
  loading?: boolean;
  isCurrency?: boolean;
}
function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  iconClass,
  loading,
  isCurrency,
}: KpiProps) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 px-5 py-5">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            iconClass ?? 'bg-slate-100 text-ink'
          }`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-muted">
            {label}
          </span>
          {loading ? (
            <Skeleton className="mt-1.5 h-7 w-20" />
          ) : (
            <span
              className={`mt-0.5 font-semibold text-ink ${
                isCurrency ? 'text-[20px]' : 'text-[26px]'
              } tracking-tight`}
            >
              {value}
            </span>
          )}
          {sub && (
            <span className="mt-0.5 text-[11.5px] text-ink-muted">{sub}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InvoiceRow({
  invoice,
  onClick,
}: {
  invoice: Invoice;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors hover:bg-canvas"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-ink-muted">
        {invoice.supplierName.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-ink">
          {invoice.invoiceNumber}{' '}
          <span className="font-normal text-ink-muted">· {invoice.supplierName}</span>
        </p>
        <p className="truncate text-[12px] text-ink-muted">
          {invoice.poNumber ? `${invoice.poNumber} · ` : ''}
          {invoice.ingestionChannel ?? 'MANUAL'} · {relativeFromNow(invoice.updatedAt)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-[13.5px] font-semibold text-ink">
          {formatCurrency(Number(invoice.totalAmount), invoice.currency)}
        </p>
        <div className="mt-0.5 flex justify-end">
          <StatusBadge status={invoice.status} size="sm" />
        </div>
      </div>
    </button>
  );
}

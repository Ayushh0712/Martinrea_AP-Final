'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Search, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { auditApi, type AuditLogRecord } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { formatDateTime } from '@/lib/utils';

function str(rec: AuditLogRecord, key: string): string {
  const v = rec[key];
  return v === null || v === undefined ? '' : String(v);
}

export default function AuditLogsPage() {
  const q = useQuery({
    queryKey: queryKeys.auditLogs,
    queryFn: auditApi.list,
    staleTime: 15_000,
  });

  const [search, setSearch] = useState('');
  const [action, setAction] = useState<string>('ALL');

  const rows = q.data ?? [];

  const actionTypes = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const a = str(r, 'actionType');
      if (a) set.add(a);
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (action !== 'ALL' && str(r, 'actionType') !== action) return false;
      if (!term) return true;
      return (
        str(r, 'invoiceId').toLowerCase().includes(term) ||
        str(r, 'performedBy').toLowerCase().includes(term) ||
        str(r, 'performedByName').toLowerCase().includes(term) ||
        str(r, 'notes').toLowerCase().includes(term)
      );
    });
  }, [rows, search, action]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">
            Audit Log
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            Immutable, append-only trail of every state change and approval action.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-medium text-ink-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
          {rows.length} entries
        </span>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by invoice id, user, or notes"
                className="pl-8"
              />
            </div>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger className="sm:w-56">
                <SelectValue placeholder="Action type" />
              </SelectTrigger>
              <SelectContent>
                {actionTypes.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a === 'ALL' ? 'All actions' : a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {q.isLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : q.isError ? (
            <p className="py-12 text-center text-[13px] text-rose-600">
              Could not load the audit log.
            </p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <History className="h-8 w-8 text-ink-subtle" />
              <p className="text-[13px] text-ink-muted">No audit entries match.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-subtle">
                    <th className="px-3 py-2 font-semibold">When</th>
                    <th className="px-3 py-2 font-semibold">Action</th>
                    <th className="px-3 py-2 font-semibold">Invoice</th>
                    <th className="px-3 py-2 font-semibold">By</th>
                    <th className="px-3 py-2 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, idx) => (
                    <tr
                      key={str(r, 'id') || idx}
                      className="border-b border-line/60 hover:bg-canvas"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                        {str(r, 'createdAt')
                          ? formatDateTime(str(r, 'createdAt'))
                          : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink">
                          {str(r, 'actionType') || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ink-muted">
                        {str(r, 'invoiceId') ? str(r, 'invoiceId').slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-ink-muted">
                        {str(r, 'performedByName') ? (
                          str(r, 'performedByName')
                        ) : str(r, 'performedBy') ? (
                          // Unresolved actor id — fall back to the UUID prefix.
                          <span className="font-mono text-[11px]">
                            {str(r, 'performedBy').slice(0, 8) + '…'}
                          </span>
                        ) : (
                          'system'
                        )}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-ink-muted">
                        {str(r, 'notes') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

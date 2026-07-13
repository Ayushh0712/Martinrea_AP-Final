import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/constants';
import type { InvoiceStatus } from '@/types/invoice';

export function StatusBadge({
  status,
  className,
  size = 'md',
}: {
  status: InvoiceStatus;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium',
        meta.badge,
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs',
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  );
}

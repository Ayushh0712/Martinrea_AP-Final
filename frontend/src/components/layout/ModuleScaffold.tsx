import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PlugZap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface ModuleScaffoldProps {
  title: string;
  description: string;
  icon: LucideIcon;
  /**
   * Optional real content. When omitted, a neutral "ready for data" empty
   * state is shown. Pass children once this module's backend is connected.
   */
  children?: ReactNode;
}

/**
 * Shared page shell for modules that are navigable for testing but not yet
 * wired to a backend. It intentionally renders NO dummy data — only the
 * module's title, description, and a clear empty state — so the page can be
 * exercised in the UI while the data contract is connected later.
 */
export function ModuleScaffold({
  title,
  description,
  icon,
  children,
}: ModuleScaffoldProps) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">
            {title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Testing build
        </span>
      </div>

      {children ?? <NotConnectedState icon={icon} title={title} />}
    </div>
  );
}

function NotConnectedState({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-5 px-6 py-16 text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-2xl bg-brand-50 blur-xl" />
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-brand shadow-elevated">
            <Icon className="h-7 w-7" strokeWidth={1.6} />
          </div>
        </div>

        <div className="max-w-md space-y-2">
          <h2 className="text-[18px] font-semibold text-ink">
            {title} is ready for data
          </h2>
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            This workspace is live for testing. No data is loaded yet — it will
            populate once the backend endpoint for this module is connected.
          </p>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-800">
          <PlugZap className="h-3.5 w-3.5" />
          Backend not connected
        </span>
      </CardContent>
    </Card>
  );
}

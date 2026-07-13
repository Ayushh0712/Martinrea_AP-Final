import { Inbox, Plus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/useAuth';
import { profileFor } from '@/lib/permissions';

/**
 * Generic "no invoices in your workspace" placeholder. Replaces the old
 * demo-seed CTA. Adapts copy based on whether the signed-in user is allowed
 * to create invoices.
 */
export function EmptyInvoicesState({
  onCreate,
}: {
  onCreate?: () => void;
}) {
  const { user } = useAuth();
  const profile = profileFor(user?.role);
  const canCreate = profile?.canCreate ?? false;

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 px-6 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand">
          <Inbox className="h-6 w-6" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h3 className="text-[17px] font-semibold text-ink">
            {canCreate
              ? 'No invoices in your workspace yet'
              : 'Nothing routed to you yet'}
          </h3>
          <p className="text-[13.5px] leading-relaxed text-ink-muted">
            {canCreate
              ? 'Capture a supplier invoice and it will flow through OCR review, matching, and the approval chain in real time.'
              : `As ${profile?.label ?? 'this role'} you'll see invoices here once an AP Clerk submits them and the routing engine assigns them to you.`}
          </p>
        </div>
        {canCreate && onCreate && (
          <Button onClick={onCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            New invoice
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

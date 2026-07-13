'use client';

import Link from 'next/link';
import { ArrowLeft, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand">
        <Compass className="h-7 w-7" />
      </div>
      <h1 className="mt-4 text-[28px] font-semibold tracking-tight text-ink">
        Page not found
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        That URL doesn't exist in the Martinrea workspace. Check the sidebar
        navigation or jump back to the dashboard.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </Button>
    </div>
  );
}

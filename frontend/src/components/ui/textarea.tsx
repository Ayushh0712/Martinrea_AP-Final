import * as React from 'react';
import { cn } from '@/lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink shadow-sm placeholder:text-ink-subtle',
        'focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

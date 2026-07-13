import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency: string = 'USD',
): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString('en-US', {
      maximumFractionDigits: 2,
    })}`;
  }
}

export function formatCompactNumber(n: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatDate(iso: string | null | undefined, pattern = 'MMM d, yyyy'): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), pattern);
  } catch {
    return '—';
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, 'MMM d, yyyy · h:mm a');
}

export function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

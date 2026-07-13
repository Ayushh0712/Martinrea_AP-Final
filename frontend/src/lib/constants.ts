import { InvoiceStatus } from '@/types/invoice';

export interface StatusMeta {
  label: string;
  short: string;
  /** Tailwind classes for badge background + text + border. */
  badge: string;
  /** Solid colour for chart datapoints. */
  color: string;
  /** Stage in the pipeline: 0 (just received) → 6 (terminal). */
  stage: number;
}

export const STATUS_META: Record<InvoiceStatus, StatusMeta> = {
  RECEIVED: {
    label: 'Received',
    short: 'Received',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    color: '#64748B',
    stage: 0,
  },
  OCR_PROCESSING: {
    label: 'OCR Processing',
    short: 'OCR',
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    color: '#0EA5E9',
    stage: 1,
  },
  PENDING_REVIEW: {
    label: 'Pending Review',
    short: 'Review',
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    color: '#F59E0B',
    stage: 2,
  },
  PENDING_MATCH: {
    label: 'Pending Match',
    short: 'Match',
    badge: 'bg-violet-50 text-violet-700 border-violet-200',
    color: '#8B5CF6',
    stage: 3,
  },
  MATCHED: {
    // PRD UI-A-02: Matched = green.
    label: 'Matched',
    short: 'Matched',
    badge: 'bg-green-50 text-green-700 border-green-200',
    color: '#22C55E',
    stage: 4,
  },
  PENDING_APPROVAL: {
    // PRD UI-A-02: Pending Approval = orange.
    label: 'Pending Approval',
    short: 'Approval',
    badge: 'bg-orange-50 text-orange-700 border-orange-200',
    color: '#F97316',
    stage: 5,
  },
  APPROVED: {
    // PRD UI-A-02: Approved = teal.
    label: 'Approved',
    short: 'Approved',
    badge: 'bg-teal-50 text-teal-700 border-teal-200',
    color: '#14B8A6',
    stage: 6,
  },
  REJECTED: {
    label: 'Rejected',
    short: 'Rejected',
    badge: 'bg-red-50 text-red-700 border-red-200',
    color: '#EF4444',
    stage: 6,
  },
  EXCEPTION: {
    label: 'Exception',
    short: 'Exception',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    color: '#F43F5E',
    stage: 6,
  },
};

export const PIPELINE_ORDER: InvoiceStatus[] = [
  'RECEIVED',
  'OCR_PROCESSING',
  'PENDING_REVIEW',
  'PENDING_MATCH',
  'MATCHED',
  'PENDING_APPROVAL',
  'APPROVED',
];

export const TERMINAL_STATUSES: InvoiceStatus[] = ['APPROVED', 'REJECTED'];

export const INGESTION_CHANNELS = [
  'EMAIL',
  'EDI',
  'PORTAL',
  'MANUAL',
  'API',
] as const;
export type IngestionChannel = (typeof INGESTION_CHANNELS)[number];

export const CURRENCIES = ['USD', 'CAD', 'MXN', 'EUR'] as const;

/**
 * Plant directory. Static config for now — when a `/plants` endpoint
 * ships this can be replaced with a `useQuery(['plants'])` hook.
 */
export const PLANTS = [
  { id: 'P-DET', name: 'Detroit, MI' },
  { id: 'P-RAM', name: 'Ramos, MX' },
  { id: 'P-MTL', name: 'Montreal, QC' },
  { id: 'P-HER', name: 'Hermosillo, MX' },
];

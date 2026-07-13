/**
 * Phase 1 role permissions — single source of truth for the frontend.
 *
 * Mirrors the NestJS `@Roles()` guards and the rules-engine routing on the
 * backend. The backend remains authoritative (any forbidden call is rejected
 * server-side); this file exists so the UI can pre-empt forbidden actions and
 * communicate WHY a given button is or isn't available.
 *
 * Phase 1 roles:
 *   - AP_Clerk         — full create / edit access; submits for review; flags exceptions
 *   - Plant_Manager    — approval rights for invoices up to $50,000
 *   - Finance_Director — approval rights for any amount; generic state transitions; SLA escalation
 *   - VP_Finance       — approval rights for any amount (Tier-3 chains, ships in Phase 2; handled gracefully today)
 */
import {
  ClipboardList,
  Crown,
  Factory,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { Role } from '@/types/user';

export interface RoleProfile {
  /** Human display label, e.g. "Plant Manager". */
  label: string;
  /** Short label for tight UI surfaces, e.g. "Plant Mgr". */
  short: string;
  /** One-line description shown to end users. */
  tagline: string;
  /** Bulleted list of concrete capabilities (used in dropdowns and login cards). */
  capabilities: string[];
  /** Whether this role may CREATE new invoices via the UI. */
  canCreate: boolean;
  /** Whether this role may EDIT existing invoice fields. */
  canEdit: boolean;
  /** Whether this role may APPROVE / REJECT invoices in PENDING_APPROVAL. */
  canApprove: boolean;
  /** Hard approval ceiling in USD — `Infinity` means no cap. 0 means the role cannot approve. */
  approvalCap: number;
  /** Whether this role can perform generic state transitions (FD-only break-glass route). */
  canForceTransition: boolean;
  /** Whether this role can trigger the SLA escalation cron on demand. */
  canTriggerEscalation: boolean;
  /** Tailwind classes for the role pill (bg / text / border). */
  pillClass: string;
  /** Glyph for the role pill. */
  icon: LucideIcon;
}

export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  AP_Clerk: {
    label: 'AP Clerk',
    short: 'AP Clerk',
    tagline: 'Create & route invoices through the workflow',
    capabilities: [
      'Create and edit invoices',
      'Submit invoices for OCR review',
      'Flag matching discrepancies as exceptions',
    ],
    canCreate: true,
    canEdit: true,
    canApprove: false,
    approvalCap: 0,
    canForceTransition: false,
    canTriggerEscalation: false,
    pillClass: 'bg-sky-50 text-sky-700 border-sky-200',
    icon: ClipboardList,
  },
  Plant_Manager: {
    label: 'Plant Manager',
    short: 'Plant Mgr',
    tagline: 'Approve invoices up to $50,000 for your plant',
    capabilities: [
      'Approve invoices up to $50,000',
      'Reject invoices (with reason)',
      'Larger invoices route to Finance Director',
    ],
    canCreate: false,
    canEdit: false,
    canApprove: true,
    approvalCap: 50_000,
    canForceTransition: false,
    canTriggerEscalation: false,
    pillClass: 'bg-amber-50 text-amber-800 border-amber-200',
    icon: Factory,
  },
  Finance_Director: {
    label: 'Finance Director',
    short: 'Finance Dir',
    tagline: 'Approve any amount and run governance actions',
    capabilities: [
      'Approve invoices of any amount',
      'Reject invoices (with reason)',
      'Force generic state transitions',
      'Trigger SLA escalation on demand',
    ],
    canCreate: false,
    canEdit: false,
    canApprove: true,
    approvalCap: Number.POSITIVE_INFINITY,
    canForceTransition: true,
    canTriggerEscalation: true,
    pillClass: 'bg-violet-50 text-violet-700 border-violet-200',
    icon: ShieldCheck,
  },
  VP_Finance: {
    label: 'VP Finance',
    short: 'VP Finance',
    tagline: 'Final-tier approval for Tier-3 chains',
    capabilities: [
      'Approve invoices of any amount',
      'Final step in Tier-3 (>$50k) approval chains',
    ],
    canCreate: false,
    canEdit: false,
    canApprove: true,
    approvalCap: Number.POSITIVE_INFINITY,
    canForceTransition: false,
    canTriggerEscalation: false,
    pillClass: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
    icon: Crown,
  },
};

export function profileFor(role: Role | null | undefined): RoleProfile | null {
  if (!role) return null;
  return ROLE_PROFILES[role] ?? null;
}

/**
 * Returns true if the user holding `role` is allowed (per the Phase-1
 * permission matrix) to give an APPROVAL decision on an invoice of `amount`.
 * The backend still has the final word — this just drives UI hints.
 */
export function canApproveAmount(
  role: Role | null | undefined,
  amount: number,
): boolean {
  const p = profileFor(role);
  if (!p || !p.canApprove) return false;
  return amount <= p.approvalCap;
}

/** USD formatter for cap display, e.g. "$50,000". `Infinity` → "Any amount". */
export function formatApprovalCap(cap: number): string {
  if (!Number.isFinite(cap)) return 'Any amount';
  if (cap === 0) return 'Not an approver';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cap);
}

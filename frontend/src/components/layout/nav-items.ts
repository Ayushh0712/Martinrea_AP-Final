import {
  LayoutDashboard,
  FileText,
  ScanLine,
  FileSearch,
  GitMerge,
  Send,
  CheckCircle2,
  CreditCard,
  Store,
  Search,
  BarChart3,
  ScrollText,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/types/user';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /**
   * True once the page is navigable. Every module is now reachable as a
   * testing scaffold (no dummy data) while its backend endpoint is wired up.
   */
  available: boolean;
  /**
   * Out of Phase 1 scope per PRD §7.3 (e.g. Supplier Self-Service Portal,
   * payment automation, advanced analytics). Locked items render as disabled,
   * darkened rows in the sidebar with a lock icon and cannot be opened.
   */
  locked?: boolean;
  /**
   * Roles allowed to see and open this tab. Omit to make the tab visible to
   * every authenticated role. Tweak these arrays to change who sees what.
   */
  roles?: Role[];
}

export interface NavSection {
  heading: string;
  items: NavItem[];
}

// Convenience groupings, anchored to the backend permission matrix + role profiles.
const APPROVERS: Role[] = ['Plant_Manager', 'Finance_Director', 'VP_Finance'];
const FINANCE: Role[] = ['Finance_Director', 'VP_Finance'];
const CAPTURE: Role[] = ['AP_Clerk']; // create/edit-capable roles

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Workspace',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard, available: true },
      { label: 'Invoice Processing', to: '/invoices', icon: FileText, available: true, roles: CAPTURE },
      { label: 'OCR Validation', to: '/ocr', icon: ScanLine, available: true, roles: CAPTURE },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { label: '2-Way / 3-Way Match', to: '/match', icon: GitMerge, available: true, roles: CAPTURE },
      { label: 'Ready to Submit', to: '/ready-to-submit', icon: Send, available: true, roles: CAPTURE },
      { label: 'Approval Workflow', to: '/approvals', icon: CheckCircle2, available: true, roles: APPROVERS },
      { label: 'Payment Packages', to: '/payments', icon: CreditCard, available: true, locked: true, roles: CAPTURE },
    ],
  },
  {
    heading: 'Insight',
    items: [
      { label: 'Vendor Portal', to: '/vendors', icon: Store, available: true, locked: true },
      { label: 'Repository Search', to: '/search', icon: Search, available: true, locked: true },
      { label: 'Analytics', to: '/analytics', icon: BarChart3, available: true, locked: true, roles: APPROVERS },
      { label: 'Audit Logs', to: '/audit', icon: ScrollText, available: true, roles: FINANCE },
    ],
  },
  {
    heading: 'System',
    items: [
      { label: 'Admin Panel', to: '/admin', icon: Settings, available: true, locked: true, roles: ['Finance_Director'] },
    ],
  },
];

/** True if `role` may see/open this nav item. Items with no `roles` are open to all. */
export function navItemAllowed(item: NavItem, role: Role | null | undefined): boolean {
  if (!item.roles) return true;
  if (!role) return false;
  return item.roles.includes(role);
}

/** Nav sections filtered to what `role` can access, dropping any now-empty section. */
export function visibleSections(role: Role | null | undefined): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => navItemAllowed(item, role)),
  })).filter((section) => section.items.length > 0);
}

/**
 * Whether `role` may access the route at `path`. Only exact nav-item paths are
 * gated; paths that don't map to a nav item (e.g. `/invoices/:id`, `/login`)
 * are always allowed, so approvers can still open invoice detail pages even
 * though the Invoice Processing list itself is clerk-only.
 */
export function canAccessPath(path: string, role: Role | null | undefined): boolean {
  const item = NAV_SECTIONS.flatMap((s) => s.items).find((i) => path === i.to);
  if (!item) return true;
  return navItemAllowed(item, role);
}

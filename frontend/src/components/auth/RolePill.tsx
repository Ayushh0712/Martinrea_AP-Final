import { cn } from '@/lib/utils';
import { ROLE_PROFILES, formatApprovalCap } from '@/lib/permissions';
import type { Role } from '@/types/user';

interface RolePillProps {
  role: Role;
  /** Append the approval cap, e.g. "Plant Manager · $50,000". */
  showCap?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export function RolePill({
  role,
  showCap = false,
  size = 'md',
  className,
}: RolePillProps) {
  const profile = ROLE_PROFILES[role];
  if (!profile) return null;
  const Icon = profile.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        profile.pillClass,
        size === 'sm'
          ? 'px-2 py-0.5 text-[10.5px]'
          : 'px-2.5 py-1 text-[11.5px]',
        className,
      )}
      title={profile.tagline}
    >
      <Icon
        className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'}
        strokeWidth={2}
      />
      {profile.label}
      {showCap && profile.canApprove && (
        <span className="opacity-75">· {formatApprovalCap(profile.approvalCap)}</span>
      )}
    </span>
  );
}

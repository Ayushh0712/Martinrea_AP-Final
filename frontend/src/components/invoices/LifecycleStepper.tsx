'use client';

import { Fragment, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { roleLabel } from '@/types/invoice';
import type { Invoice } from '@/types/invoice';

/**
 * Horizontal invoice-lifecycle roadmap: circles connected by a progress line,
 * with the stage label (and an optional caption) underneath.
 *
 * Main row: Ingested → OCR Processing → Review → Match → Sent for Approval →
 * one circle per approver → Approved. Before submit-approval computes the
 * real chain, the approver circles are projected from `predictedRoleChain`
 * (the amount-matched WF-03 rule), so a $12k invoice shows
 * "Plant Manager → Finance Director" from day one.
 *
 * Off-ramps and loop-backs:
 *  - EXCEPTION renders as a red circle in a LOWER LANE anchored under the
 *    stage it diverted from (`exceptionFrom`), fed by a dashed down arrow.
 *    After retrieval the lane circle turns muted and an amber return arrow
 *    curves back up into Review. Only the latest exception cycle is shown —
 *    `exceptionFrom` is overwritten each time an invoice enters EXCEPTION.
 *  - An approver rejection (PENDING_REVIEW with previousStatus
 *    PENDING_APPROVAL) reconstructs the last cycle's chain from
 *    `approvalsCompleted`: earlier sign-offs stay green, the rejecting
 *    approver turns red, and a dashed rose arc loops from that node back to
 *    Review.
 *  - REJECTED (terminal, exception dead-end) ends the roadmap with a red node.
 */

type StepState = 'done' | 'current' | 'upcoming' | 'diverted';
type StepKind = 'normal' | 'rejected';

interface Step {
  key: string;
  label: string;
  caption?: string;
  state: StepState;
  kind: StepKind;
  /** This stage was re-entered from the exception queue. */
  retrieved?: boolean;
  /** Rejecting approver node: origin of the loop-back arc to Review. */
  loopSource?: boolean;
}

/** The exception circle shown in the lane below the main row. */
interface ExceptionLane {
  /** active = sitting in the queue now; retrieved = pulled back to Review. */
  mode: 'active' | 'retrieved';
  /** Main-row stage key the exception diverted from (arrow source). */
  anchorKey: string;
}

const BASE_STAGES: Array<{ key: string; label: string }> = [
  { key: 'ingested', label: 'Ingested' },
  { key: 'ocr', label: 'OCR Processing' },
  { key: 'review', label: 'Review' },
  { key: 'match', label: 'Match' },
  { key: 'sent', label: 'Sent for Approval' },
];

const REVIEW_KEY = 'review';

/** Roadmap position of each in-pipeline status (index into BASE_STAGES). */
const STAGE_INDEX: Partial<Record<Invoice['status'], number>> = {
  RECEIVED: 0,
  OCR_PROCESSING: 1,
  PENDING_REVIEW: 2,
  PENDING_MATCH: 3,
  // MATCHED rests before submission: "Sent for Approval" is the current step.
  MATCHED: 4,
};

/** Main-row stage index the latest exception cycle diverted from. */
function divertIndex(invoice: Invoice): number {
  // exceptionFrom survives retrieval; previousStatus covers rows that entered
  // EXCEPTION before the column existed. Default: Review (OCR-validation
  // rejects are created directly at EXCEPTION while reviewing the extraction).
  const src =
    invoice.exceptionFrom ??
    (invoice.status === 'EXCEPTION' ? invoice.previousStatus : null);
  switch (src) {
    case 'OCR_PROCESSING':
      return 1;
    case 'PENDING_MATCH':
      return 3;
    case 'MATCHED':
      return 4;
    default:
      return 2;
  }
}

/** Lane descriptor for the latest exception cycle, or null when none shows. */
function exceptionLaneFor(invoice: Invoice | null | undefined): ExceptionLane | null {
  if (!invoice) return null;
  if (invoice.status === 'EXCEPTION') {
    return { mode: 'active', anchorKey: BASE_STAGES[divertIndex(invoice)].key };
  }
  if (
    invoice.status === 'PENDING_REVIEW' &&
    invoice.previousStatus === 'EXCEPTION'
  ) {
    return { mode: 'retrieved', anchorKey: BASE_STAGES[divertIndex(invoice)].key };
  }
  return null;
}

function baseStep(
  idx: number,
  state: StepState,
  extra?: Partial<Step>,
): Step {
  return {
    key: BASE_STAGES[idx].key,
    label: BASE_STAGES[idx].label,
    state,
    kind: 'normal',
    ...extra,
  };
}

/** Upcoming circles projected from the amount-matched routing rule. */
function predictedSteps(invoice: Invoice): Step[] {
  return (invoice.predictedRoleChain ?? []).map((role, i) => ({
    key: `predicted-${role}-${i}`,
    label: roleLabel(role) ?? `Approver ${i + 1}`,
    caption: 'Projected',
    state: 'upcoming' as StepState,
    kind: 'normal' as StepKind,
  }));
}

/**
 * One circle per approver. Preference order: the real chain (with display
 * details), the predicted role chain from the routing rules, and finally a
 * single generic "Approval" circle.
 */
function approverSteps(invoice: Invoice): Step[] {
  const details =
    invoice.approvalChainDetails && invoice.approvalChainDetails.length > 0
      ? invoice.approvalChainDetails
      : (invoice.approvalChain ?? []).map((id) => ({
          userId: id,
          name: null,
          role: null,
        }));

  if (details.length === 0) {
    const predicted = predictedSteps(invoice);
    if (predicted.length > 0) return predicted;
    return [
      {
        key: 'approval',
        label: 'Approval',
        state: 'upcoming',
        kind: 'normal',
      },
    ];
  }

  const completed = invoice.approvalsCompleted ?? [];
  return details.map((d, i) => {
    const approvedRecord = completed.find(
      (c) => c.approverId === d.userId && c.decision === 'APPROVED',
    );
    const done = !!approvedRecord || invoice.status === 'APPROVED';
    const isCurrent =
      !done &&
      invoice.status === 'PENDING_APPROVAL' &&
      invoice.currentApproverId === d.userId;
    return {
      key: `approver-${d.userId}-${i}`,
      label: roleLabel(d.role) ?? d.name ?? `Approver ${i + 1}`,
      caption: approvedRecord
        ? `Approved ${formatDate(approvedRecord.timestamp, 'MMM d')}`
        : done
        ? 'Approved'
        : isCurrent
        ? 'Awaiting approval'
        : 'Up next',
      state: done ? 'done' : isCurrent ? 'current' : 'upcoming',
      kind: 'normal' as const,
    };
  });
}

/**
 * One-line chain progress, e.g. "Plant Manager approved · Awaiting Finance
 * Director". Null when there is no chain or no approver display details.
 */
export function approvalSummary(invoice: Invoice): string | null {
  const details = invoice.approvalChainDetails ?? [];
  if (details.length === 0) return null;
  const completed = invoice.approvalsCompleted ?? [];
  const label = (d: { role: string | null; name: string | null }, i: number) =>
    roleLabel(d.role) ?? d.name ?? `Approver ${i + 1}`;

  const approved = details
    .filter((d) =>
      completed.some(
        (c) => c.approverId === d.userId && c.decision === 'APPROVED',
      ),
    )
    .map(label);
  const currentIdx = details.findIndex(
    (d) => d.userId === invoice.currentApproverId,
  );

  const parts: string[] = [];
  if (approved.length > 0) parts.push(`${approved.join(', ')} approved`);
  if (currentIdx >= 0) parts.push(`Awaiting ${label(details[currentIdx], currentIdx)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function buildLifecycleSteps(
  invoice: Invoice | null | undefined,
  preview = false,
): Step[] {
  // OCR-extraction preview: the document is captured and a human is
  // validating the extraction — the Review stage is live, nothing persisted.
  if (preview || !invoice) {
    return [
      baseStep(0, 'done'),
      baseStep(1, 'done'),
      baseStep(2, 'current', { caption: 'Validating extraction' }),
      baseStep(3, 'upcoming'),
      baseStep(4, 'upcoming'),
      { key: 'approval', label: 'Approval', state: 'upcoming', kind: 'normal' },
      { key: 'approved', label: 'Approved', state: 'upcoming', kind: 'normal' },
    ];
  }

  const status = invoice.status;

  if (status === 'REJECTED') {
    return [
      baseStep(0, 'done'),
      baseStep(1, 'done'),
      baseStep(2, 'done'),
      {
        key: 'rejected',
        label: 'Rejected',
        caption: invoice.rejectionReason ?? 'Closed — will not be paid',
        state: 'current',
        kind: 'rejected',
      },
    ];
  }

  if (status === 'EXCEPTION') {
    // The red Exception circle lives in the lower lane (see exceptionLaneFor);
    // the main row keeps the clean road with the divert stage tinted rose.
    const divertIdx = divertIndex(invoice);
    const steps: Step[] = BASE_STAGES.map((_, i) =>
      i < divertIdx
        ? baseStep(i, 'done')
        : i === divertIdx
        ? baseStep(i, 'diverted', { caption: 'Diverted to exception' })
        : baseStep(i, 'upcoming'),
    );
    steps.push(
      ...approverSteps(invoice).map((s) => ({ ...s, state: 'upcoming' as StepState })),
    );
    steps.push({ key: 'approved', label: 'Approved', state: 'upcoming', kind: 'normal' });
    return steps;
  }

  // Returned by an approver: reconstruct the last cycle's chain from
  // approvalsCompleted so the rejecting stage shows red with a loop-back arc
  // into Review, while earlier sign-offs stay green.
  if (
    status === 'PENDING_REVIEW' &&
    invoice.previousStatus === 'PENDING_APPROVAL'
  ) {
    const records = invoice.approvalsCompleted ?? [];
    const details = invoice.approvalsCompletedDetails ?? [];
    const rejectIdx = records.findIndex((r) => r.decision === 'REJECTED');
    const rejectorDetail = rejectIdx >= 0 ? details[rejectIdx] : undefined;
    const rejectorLabel = rejectorDetail
      ? roleLabel(rejectorDetail.role) ?? rejectorDetail.name ?? 'approver'
      : 'approver';

    const steps: Step[] = [
      baseStep(0, 'done'),
      baseStep(1, 'done'),
      baseStep(2, 'current', { caption: `Returned by ${rejectorLabel}` }),
      // Match and submission must be redone after the fix, so they're ahead.
      baseStep(3, 'upcoming'),
      baseStep(4, 'upcoming'),
    ];

    records.forEach((r, i) => {
      const d = details[i];
      const label =
        (d ? roleLabel(d.role) ?? d.name : null) ?? `Approver ${i + 1}`;
      if (r.decision === 'REJECTED') {
        steps.push({
          key: `rejected-${r.approverId}-${i}`,
          label,
          caption: `Rejected ${formatDate(r.timestamp, 'MMM d')}`,
          state: 'current',
          kind: 'rejected',
          loopSource: true,
        });
      } else {
        steps.push({
          key: `approved-${r.approverId}-${i}`,
          label,
          caption: `Approved ${formatDate(r.timestamp, 'MMM d')}`,
          state: 'done',
          kind: 'normal',
        });
      }
    });

    // Roles the rule requires beyond the recorded decisions (e.g. FD when the
    // Plant Manager rejected at step 1 of a two-step chain).
    const predicted = predictedSteps(invoice);
    for (let i = records.length; i < predicted.length; i++) {
      steps.push(predicted[i]);
    }

    steps.push({ key: 'approved', label: 'Approved', state: 'upcoming', kind: 'normal' });
    return steps;
  }

  // Happy path. PENDING_APPROVAL / APPROVED have every base stage behind them.
  const stageIdx = STAGE_INDEX[status] ?? BASE_STAGES.length;

  const steps: Step[] = BASE_STAGES.map((_, i) => {
    if (i < stageIdx) return baseStep(i, 'done');
    if (i > stageIdx) return baseStep(i, 'upcoming');
    // Current base stage — decorate the interesting cases.
    if (status === 'PENDING_REVIEW' && invoice.previousStatus === 'EXCEPTION') {
      return baseStep(i, 'current', {
        retrieved: true,
        caption: 'Retrieved from exception',
      });
    }
    if (status === 'MATCHED') {
      return baseStep(i, 'current', { caption: 'Ready to submit' });
    }
    return baseStep(i, 'current');
  });

  steps.push(...approverSteps(invoice));
  steps.push({
    key: 'approved',
    label: 'Approved',
    caption:
      status === 'APPROVED'
        ? formatDate(invoice.updatedAt, 'MMM d, yyyy')
        : undefined,
    state: status === 'APPROVED' ? 'done' : 'upcoming',
    kind: 'normal',
  });
  return steps;
}

// ────────────────────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────────────────────

const SIZES = {
  md: {
    circle: 'h-9 w-9 text-[12.5px]',
    circlePx: 36,
    icon: 'h-4 w-4',
    label: 'text-[11.5px]',
    caption: 'text-[10.5px]',
    // Content-based column: long labels ("Finance Director") get more room,
    // short ones ("Match") take less.
    column: 'min-w-[76px] max-w-[132px] px-1',
    connector: 'mt-[17px] min-w-5',
    laneSpace: 88,
  },
  sm: {
    circle: 'h-7 w-7 text-[11px]',
    circlePx: 28,
    icon: 'h-3.5 w-3.5',
    label: 'text-[10.5px]',
    caption: 'text-[9.5px]',
    column: 'min-w-[64px] max-w-[116px] px-1',
    connector: 'mt-[13px] min-w-4',
    laneSpace: 76,
  },
} as const;

/** Vertical headroom (px) reserved above the circles for loop-back arcs. */
const ARC_HEADROOM = 28;

interface ArcPath {
  d: string;
  tone: 'rose' | 'amber';
}

function circleClasses(step: Step): string {
  if (step.kind === 'rejected') {
    return 'border-rose-600 bg-rose-600 text-white ring-4 ring-rose-100';
  }
  switch (step.state) {
    case 'done':
      return 'border-emerald-500 bg-emerald-500 text-white';
    case 'current':
      return 'border-brand bg-brand text-white ring-4 ring-brand-100';
    case 'diverted':
      return 'border-rose-400 bg-rose-50 text-rose-600';
    default:
      return 'border-line bg-white text-ink-subtle';
  }
}

const ARC_STROKE = {
  rose: 'stroke-rose-400',
  amber: 'stroke-amber-500',
} as const;
const ARC_FILL = {
  rose: 'fill-rose-400',
  amber: 'fill-amber-500',
} as const;

export function LifecycleStepper({
  invoice,
  preview = false,
  size = 'md',
  className,
}: {
  invoice?: Invoice | null;
  /** OCR-extraction mode: render the roadmap with Review as the live stage. */
  preview?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const steps = buildLifecycleSteps(invoice, preview);
  const s = SIZES[size];

  const lane = preview ? null : exceptionLaneFor(invoice);
  const loopSource = steps.find((st) => st.loopSource);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const circleRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [paths, setPaths] = useState<ArcPath[]>([]);
  const [lanePos, setLanePos] = useState<{ x: number; y: number } | null>(null);

  const geometryKey = [
    loopSource ? `loop:${loopSource.key}` : '',
    lane ? `lane:${lane.mode}:${lane.anchorKey}` : '',
    size,
  ].join('|');

  const measure = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || (!lane && !loopSource)) {
      setPaths((prev) => (prev.length === 0 ? prev : []));
      setLanePos((prev) => (prev === null ? prev : null));
      return;
    }
    const wRect = wrapper.getBoundingClientRect();
    const geo = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - wRect.left + r.width / 2,
        top: r.top - wRect.top,
        bottom: r.top - wRect.top + r.height,
      };
    };

    const next: ArcPath[] = [];

    // Rejection loop-back: red approver node → Review, over the top.
    if (loopSource) {
      const fromEl = circleRefs.current.get(loopSource.key);
      const toEl = circleRefs.current.get(REVIEW_KEY);
      if (fromEl && toEl) {
        const f = geo(fromEl);
        const t = geo(toEl);
        const lift = Math.max(t.top, f.top) - (ARC_HEADROOM - 6);
        next.push({
          d: `M ${f.x} ${f.top - 2} C ${f.x} ${lift}, ${t.x} ${lift}, ${t.x} ${t.top - 3}`,
          tone: 'rose',
        });
      }
    }

    // Exception lane: circle below the row + down arrow (+ return arrow).
    let nextLane: { x: number; y: number } | null = null;
    if (lane) {
      const anchorEl = circleRefs.current.get(lane.anchorKey);
      const reviewEl = circleRefs.current.get(REVIEW_KEY);
      if (anchorEl && reviewEl) {
        const a = geo(anchorEl);
        const rv = geo(reviewEl);
        // Just below the tallest column (wrapper height minus the reserved
        // lane space), so labels never collide with the lane circle.
        const laneTop = wRect.height - s.laneSpace + 8;
        const x =
          lane.mode === 'retrieved'
            ? lane.anchorKey === REVIEW_KEY
              ? rv.x + Math.max(s.circlePx * 1.6, 44)
              : (a.x + rv.x) / 2
            : a.x;
        nextLane = { x, y: laneTop };

        const inX = lane.mode === 'retrieved' ? x + 9 : x;
        next.push({
          d: `M ${a.x} ${a.bottom + 2} C ${a.x} ${a.bottom + 26}, ${inX} ${laneTop - 26}, ${inX} ${laneTop - 2}`,
          tone: 'rose',
        });
        if (lane.mode === 'retrieved') {
          const outX = x - 9;
          next.push({
            d: `M ${outX} ${laneTop - 2} C ${outX} ${laneTop - 26}, ${rv.x} ${rv.bottom + 26}, ${rv.x} ${rv.bottom + 3}`,
            tone: 'amber',
          });
        }
      }
    }

    setPaths(next);
    setLanePos(nextLane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryKey]);

  useLayoutEffect(() => {
    measure();
    const wrapper = wrapperRef.current;
    if (!wrapper || (!lane && !loopSource)) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrapper);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure]);

  return (
    <div className={cn('overflow-x-auto pb-1', className)}>
      <div
        ref={wrapperRef}
        role="list"
        aria-label="Invoice lifecycle"
        className="relative flex w-fit min-w-full items-start"
        style={{
          paddingTop: loopSource ? ARC_HEADROOM : undefined,
          paddingBottom: lane ? s.laneSpace : undefined,
        }}
      >
        {steps.map((step, i) => {
          // The segment leading INTO this step takes this step's colour story:
          // green when progress flowed here from a reached stage, muted
          // otherwise; rose when it feeds the terminal rejected node.
          const prev = i > 0 ? steps[i - 1] : null;
          const reached = step.state === 'done' || step.state === 'current';
          const prevReached =
            !prev || prev.state === 'done' || prev.state === 'current';
          const connectorColor =
            step.kind === 'rejected'
              ? 'bg-rose-300'
              : reached && prevReached
              ? 'bg-emerald-300'
              : 'bg-line';
          const number = i + 1;

          return (
            <Fragment key={step.key}>
              {i > 0 && (
                <div
                  aria-hidden
                  className={cn('h-0.5 flex-1', s.connector, connectorColor)}
                />
              )}
              <div
                role="listitem"
                className={cn('flex shrink-0 flex-col items-center gap-1.5', s.column)}
              >
                <span
                  ref={(el) => {
                    if (el) circleRefs.current.set(step.key, el);
                    else circleRefs.current.delete(step.key);
                  }}
                  title={step.retrieved ? 'Retrieved from exception' : undefined}
                  className={cn(
                    'flex items-center justify-center rounded-full border font-semibold transition-colors',
                    s.circle,
                    circleClasses(step),
                  )}
                >
                  {step.kind === 'rejected' ? (
                    <X className={s.icon} />
                  ) : step.state === 'done' ? (
                    <Check className={s.icon} />
                  ) : step.state === 'diverted' ? (
                    <AlertTriangle className={s.icon} />
                  ) : (
                    number
                  )}
                </span>
                <div className="flex w-full flex-col items-center gap-0.5">
                  <p
                    className={cn(
                      'max-w-full text-center font-semibold leading-tight',
                      s.label,
                      step.kind !== 'normal' || step.state === 'diverted'
                        ? 'text-rose-700'
                        : step.state === 'upcoming'
                        ? 'text-ink-subtle'
                        : 'text-ink',
                    )}
                  >
                    {step.label}
                  </p>
                  {step.caption && (
                    <p
                      className={cn(
                        'max-w-full truncate text-center leading-tight',
                        s.caption,
                        step.kind !== 'normal' || step.state === 'diverted'
                          ? 'text-rose-600'
                          : 'text-ink-muted',
                      )}
                      title={step.caption}
                    >
                      {step.caption}
                    </p>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}

        {/* Exception lane circle (latest cycle only). */}
        {lane && lanePos && (
          <div
            role="listitem"
            className="absolute flex -translate-x-1/2 flex-col items-center gap-1"
            style={{ left: lanePos.x, top: lanePos.y }}
          >
            <span
              className={cn(
                'flex items-center justify-center rounded-full border font-semibold',
                s.circle,
                lane.mode === 'active'
                  ? 'border-rose-500 bg-rose-500 text-white ring-4 ring-rose-100'
                  : 'border-rose-300 bg-rose-50 text-rose-500',
              )}
            >
              <AlertTriangle className={s.icon} />
            </span>
            <div className="flex flex-col items-center">
              <p className={cn('font-semibold leading-tight text-rose-700', s.label)}>
                Exception
              </p>
              <p className={cn('leading-tight text-rose-600', s.caption)}>
                {lane.mode === 'active' ? 'In exception queue' : 'Retrieved'}
              </p>
            </div>
          </div>
        )}

        {paths.length > 0 && (
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <defs>
              <marker
                id="lc-arrow-rose"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" className={ARC_FILL.rose} />
              </marker>
              <marker
                id="lc-arrow-amber"
                viewBox="0 0 8 8"
                refX="6"
                refY="4"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" className={ARC_FILL.amber} />
              </marker>
            </defs>
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                className={ARC_STROKE[p.tone]}
                markerEnd={`url(#lc-arrow-${p.tone})`}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

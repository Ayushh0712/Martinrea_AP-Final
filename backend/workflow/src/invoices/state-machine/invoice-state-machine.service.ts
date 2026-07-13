import { ConflictException, Injectable } from '@nestjs/common';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';
import { ALLOWED_TRANSITIONS } from './transitions';

/**
 * Pure (DB-free) state machine for the invoice lifecycle.
 *
 * The service has no I/O - it can be unit-tested in isolation and
 * reused by anything that needs to ask "can this invoice move to X?"
 * (e.g. the dashboard for enabling/disabling action buttons).
 *
 * Per PRD WF-02 acceptance criterion, any disallowed transition raises
 * a ConflictException (HTTP 409) with a descriptive error message.
 */
@Injectable()
export class InvoiceStateMachineService {
  /**
   * @returns true when `from -> to` is in the permitted transition map.
   */
  canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  /**
   * Throws ConflictException (HTTP 409) if the transition is disallowed.
   * Used by InvoicesService.transition() before writing to the DB.
   */
  assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];

    if (!allowed.includes(to)) {
      throw new ConflictException(
        `Illegal invoice transition '${from}' -> '${to}'. ` +
          `Allowed next states from '${from}': ` +
          (allowed.length === 0 ? '(none - terminal state)' : allowed.join(', ')),
      );
    }
  }

  /** Returns the list of states an invoice in `from` may transition to. */
  getAllowedTransitions(from: InvoiceStatus): InvoiceStatus[] {
    return [...(ALLOWED_TRANSITIONS[from] ?? [])];
  }
}

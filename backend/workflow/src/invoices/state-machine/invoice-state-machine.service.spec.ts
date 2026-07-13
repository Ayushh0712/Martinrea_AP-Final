import { ConflictException } from '@nestjs/common';
import { InvoiceStateMachineService } from './invoice-state-machine.service';
import { InvoiceStatus } from '../../common/enums/invoice-status.enum';

describe('InvoiceStateMachineService', () => {
  let sm: InvoiceStateMachineService;

  beforeEach(() => {
    sm = new InvoiceStateMachineService();
  });

  describe('happy path (PRD Section 5.2)', () => {
    const happyPath: Array<[InvoiceStatus, InvoiceStatus]> = [
      [InvoiceStatus.RECEIVED, InvoiceStatus.OCR_PROCESSING],
      [InvoiceStatus.OCR_PROCESSING, InvoiceStatus.PENDING_REVIEW],
      [InvoiceStatus.PENDING_REVIEW, InvoiceStatus.PENDING_MATCH],
      [InvoiceStatus.PENDING_MATCH, InvoiceStatus.MATCHED],
      [InvoiceStatus.MATCHED, InvoiceStatus.PENDING_APPROVAL],
      [InvoiceStatus.PENDING_APPROVAL, InvoiceStatus.APPROVED],
    ];

    test.each(happyPath)('allows %s -> %s', (from, to) => {
      expect(sm.canTransition(from, to)).toBe(true);
      expect(() => sm.assertTransition(from, to)).not.toThrow();
    });
  });

  describe('illegal transitions throw 409 (PRD WF-02)', () => {
    test('RECEIVED -> APPROVED (skipping all intermediate states)', () => {
      expect(sm.canTransition(InvoiceStatus.RECEIVED, InvoiceStatus.APPROVED)).toBe(
        false,
      );
      expect(() =>
        sm.assertTransition(InvoiceStatus.RECEIVED, InvoiceStatus.APPROVED),
      ).toThrow(ConflictException);
    });

    test('PENDING_REVIEW -> APPROVED', () => {
      expect(() =>
        sm.assertTransition(
          InvoiceStatus.PENDING_REVIEW,
          InvoiceStatus.APPROVED,
        ),
      ).toThrow(/Illegal invoice transition/);
    });

    test('APPROVED is terminal - no outbound transitions', () => {
      expect(sm.getAllowedTransitions(InvoiceStatus.APPROVED)).toEqual([]);
      expect(() =>
        sm.assertTransition(InvoiceStatus.APPROVED, InvoiceStatus.PENDING_REVIEW),
      ).toThrow(/terminal state/);
    });

    test('error message includes the allowed next states', () => {
      expect(() =>
        sm.assertTransition(
          InvoiceStatus.PENDING_REVIEW,
          InvoiceStatus.APPROVED,
        ),
      ).toThrow(/PENDING_MATCH/);
    });
  });

  describe('off-ramps', () => {
    test('PENDING_APPROVAL -> REJECTED is allowed', () => {
      expect(
        sm.canTransition(
          InvoiceStatus.PENDING_APPROVAL,
          InvoiceStatus.REJECTED,
        ),
      ).toBe(true);
    });

    test('REJECTED -> PENDING_REVIEW (rework, PRD WF-03)', () => {
      expect(
        sm.canTransition(InvoiceStatus.REJECTED, InvoiceStatus.PENDING_REVIEW),
      ).toBe(true);
    });

    test('PENDING_MATCH -> EXCEPTION (discrepancy flagged from workbench)', () => {
      expect(
        sm.canTransition(InvoiceStatus.PENDING_MATCH, InvoiceStatus.EXCEPTION),
      ).toBe(true);
    });

    test('EXCEPTION -> PENDING_MATCH (supervisor resolves)', () => {
      expect(
        sm.canTransition(InvoiceStatus.EXCEPTION, InvoiceStatus.PENDING_MATCH),
      ).toBe(true);
    });

    test('EXCEPTION -> REJECTED (supervisor rejects)', () => {
      expect(
        sm.canTransition(InvoiceStatus.EXCEPTION, InvoiceStatus.REJECTED),
      ).toBe(true);
    });
  });

  describe('getAllowedTransitions', () => {
    test('returns exactly the allowed next states for PENDING_APPROVAL', () => {
      expect(sm.getAllowedTransitions(InvoiceStatus.PENDING_APPROVAL).sort()).toEqual(
        [InvoiceStatus.APPROVED, InvoiceStatus.REJECTED].sort(),
      );
    });

    test('returns a fresh array (no shared mutable reference)', () => {
      const a = sm.getAllowedTransitions(InvoiceStatus.RECEIVED);
      a.push(InvoiceStatus.APPROVED);
      const b = sm.getAllowedTransitions(InvoiceStatus.RECEIVED);
      expect(b).toEqual([InvoiceStatus.OCR_PROCESSING]);
    });
  });
});

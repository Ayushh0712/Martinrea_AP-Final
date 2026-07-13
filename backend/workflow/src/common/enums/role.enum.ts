/**
 * Phase 1 roles per PRD Section 4.7 (WF-01) and the WF-03 routing tiers.
 *
 * AP_Clerk           - Creates and edits invoices; CANNOT approve.
 * Plant_Manager      - First approver for invoices > $10,000.
 * Finance_Director   - Approver for all amounts (and sole approver <= $10,000).
 * VP_Finance         - Final approver in the > $50,000 chain (PRD WF-03 rule 3).
 */
export enum Role {
  AP_CLERK = 'AP_Clerk',
  PLANT_MANAGER = 'Plant_Manager',
  FINANCE_DIRECTOR = 'Finance_Director',
  VP_FINANCE = 'VP_Finance',
}

export const APPROVER_ROLES: ReadonlyArray<Role> = [
  Role.PLANT_MANAGER,
  Role.FINANCE_DIRECTOR,
  Role.VP_FINANCE,
];

export const PLANT_MANAGER_LIMIT_USD = 50_000;

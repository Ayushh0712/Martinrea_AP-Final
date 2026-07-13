import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ApprovalRule } from './entities/approval-rule.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';

export interface ComputedApprovalChain {
  rule: { id: string; name: string };
  roleChain: Role[];
  userChain: string[];
}

@Injectable()
export class RulesEngineService {
  private readonly logger = new Logger(RulesEngineService.name);

  constructor(
    @InjectModel(ApprovalRule)
    private readonly ruleModel: typeof ApprovalRule,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  /**
   * Compute the ordered approval chain for an invoice based on amount.
   *
   * Returns both the role chain (audit trail) and the resolved user chain
   * (used to populate invoice.approval_chain and invoice.current_approver_id).
   *
   * @throws when no matching rule exists for the amount
   * @throws when a required role cannot be resolved to a user
   *         (e.g. no Plant_Manager exists for the invoice's plant)
   */
  async computeApprovalChain(
    amount: number,
    plantId: string | null,
  ): Promise<ComputedApprovalChain> {
    const rule = await this.matchRule(amount);
    if (!rule) {
      throw new InternalServerErrorException(
        `No active approval rule matches amount ${amount}. ` +
          `Seed Rules_Engine via 'npm run seed:rules' or check PRD WF-03 defaults.`,
      );
    }

    // De-duplicate resolved users while preserving order: if two roles resolve
    // to the same person (or a rule lists a role twice), a single sign-off must
    // not appear twice, otherwise `approve()`'s indexOf-based step advancement
    // breaks and the invoice would demand the same user to approve twice.
    const userChain: string[] = [];
    const seen = new Set<string>();
    for (const role of rule.roleChain) {
      const user = await this.resolveApproverForRole(role, plantId);
      if (!user) {
        throw new InternalServerErrorException(
          `Routing rule '${rule.ruleName}' requires role '${role}' but no active user with that role ` +
            `${role === Role.PLANT_MANAGER ? `(plant=${plantId ?? 'N/A'}) ` : ''}exists.`,
        );
      }
      if (!seen.has(user.id)) {
        seen.add(user.id);
        userChain.push(user.id);
      }
    }

    // A rule with an empty roleChain (or one that de-duped to nothing) would
    // leave the invoice PENDING_APPROVAL with no current approver - stranded and
    // un-actionable. Fail loudly at routing time instead.
    if (userChain.length === 0) {
      throw new InternalServerErrorException(
        `Routing rule '${rule.ruleName}' resolved to an empty approver chain. ` +
          `Check its roleChain and that active approver users exist.`,
      );
    }

    this.logger.log(
      `Rule='${rule.ruleName}' amount=$${amount} roleChain=[${rule.roleChain.join(',')}] userChain=[${userChain.join(',')}]`,
    );

    return {
      rule: { id: rule.id, name: rule.ruleName },
      roleChain: rule.roleChain,
      userChain,
    };
  }

  /**
   * Display-only projection of the role chain each amount would route
   * through. One rules query, in-memory first-match per amount with the same
   * semantics as `matchRule`. Never throws and resolves no users — an amount
   * with no matching rule yields null. Exists so the lifecycle stepper can
   * show the road ahead ("Plant Manager → Finance Director") before
   * submit-approval computes the real chain.
   */
  async predictRoleChains(amounts: number[]): Promise<(Role[] | null)[]> {
    if (amounts.length === 0) return [];
    const rules = await this.activeRules();
    return amounts.map((amount) => this.firstMatch(rules, amount)?.roleChain ?? null);
  }

  /**
   * First-match rule selection. Order: priority ASC, then min_amount ASC.
   * A rule matches when:
   *   (min IS NULL OR amount >  min)
   * AND (max IS NULL OR amount <= max)
   *
   * Note the strict greater-than on min — tier boundaries are exclusive on
   * the lower edge so $10,000.00 falls into Tier 1, $10,000.01 into Tier 2.
   */
  private async matchRule(amount: number): Promise<ApprovalRule | null> {
    return this.firstMatch(await this.activeRules(), amount);
  }

  private async activeRules(): Promise<ApprovalRule[]> {
    return this.ruleModel.findAll({
      where: { isActive: true },
      order: [
        ['priority', 'ASC'],
        ['minAmount', 'ASC'],
      ],
    });
  }

  private firstMatch(rules: ApprovalRule[], amount: number): ApprovalRule | null {
    for (const r of rules) {
      const min = r.minAmount === null ? null : parseFloat(r.minAmount as unknown as string);
      const max = r.maxAmount === null ? null : parseFloat(r.maxAmount as unknown as string);
      const minOk = min === null || amount > min;
      const maxOk = max === null || amount <= max;
      if (minOk && maxOk) {
        return r;
      }
    }
    return null;
  }

  private async resolveApproverForRole(
    role: Role,
    plantId: string | null,
  ): Promise<User | null> {
    // Plant Managers are normally plant-scoped. Prefer the manager bound to the
    // invoice's plant, but fall back to any active Plant Manager when the invoice
    // has no plant or no plant-specific manager exists, so approvals still route
    // to the (currently single) Plant Manager instead of failing.
    if (role === Role.PLANT_MANAGER && plantId) {
      const scoped = await this.userModel.findAll({
        where: { role, isActive: true, plantId },
        order: [['createdAt', 'ASC']],
      });
      if (scoped.length > 0) {
        if (scoped.length > 1) {
          this.logger.warn(
            `Ambiguous approver: ${scoped.length} active ${role}s for plant ${plantId}. ` +
              `Routing to oldest (${scoped[0].email}). Keep one active user per role/plant.`,
          );
        }
        return scoped[0];
      }
      this.logger.warn(
        `No active ${role} for plant ${plantId}; falling back to any active ${role}. ` +
          `This can route the invoice to a different plant's manager.`,
      );
    }

    const candidates = await this.userModel.findAll({
      where: { role, isActive: true },
      order: [['createdAt', 'ASC']],
    });
    if (candidates.length > 1) {
      this.logger.warn(
        `Ambiguous approver: ${candidates.length} active ${role}s exist. ` +
          `Routing to oldest (${candidates[0].email}). Keep one active user per role.`,
      );
    }
    return candidates[0] ?? null;
  }
}

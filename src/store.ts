import type { RuleParams } from "./vocabulary";

/**
 * Storage contract for rules and their firing ledger. The ledger is BOTH the
 * dedupe record (per rule+entity cooldown) and the caps counter (per owner
 * per day) — one table, two guards.
 */

export type StoredRule<
  TTrigger extends string = string,
  TAction extends string = string,
> = {
  id: string;
  ownerId: string;
  trigger: TTrigger;
  action: TAction;
  triggerParams: RuleParams;
  actionParams: RuleParams;
  guidance: string | null;
  autoSend: boolean;
  enabled: boolean;
};

export type FiringCounts = {
  /** All recorded firings in the window. */
  total: number;
  /** The subset that auto-executed (vs queued for approval). */
  auto: number;
};

export type RuleStore<
  TTrigger extends string = string,
  TAction extends string = string,
> = {
  /** Enabled rules for an owner, optionally narrowed to one trigger. */
  listEnabledRules: (
    ownerId: string,
    trigger?: TTrigger,
  ) => Promise<StoredRule<TTrigger, TAction>[]>;
  /** Has this rule already fired for this entity since `since`? */
  hasRecentFiring: (
    ruleId: string,
    entityId: string,
    since: Date,
  ) => Promise<boolean>;
  /** The owner's firing counts since `since` (daily caps). */
  countFirings: (ownerId: string, since: Date) => Promise<FiringCounts>;
  /** Record one firing (also stamps the rule's lastFiredAt if tracked). */
  recordFiring: (input: {
    ruleId: string;
    ownerId: string;
    entityId: string;
    outcome: string;
    autoSent: boolean;
  }) => Promise<void>;
};

type MemoryFiring = {
  autoSent: boolean;
  entityId: string;
  firedAt: Date;
  ownerId: string;
  ruleId: string;
};

/** In-memory store — tests and prototypes. */
export const createMemoryRuleStore = <
  TTrigger extends string,
  TAction extends string,
>(
  rules: StoredRule<TTrigger, TAction>[],
): RuleStore<TTrigger, TAction> & { firings: MemoryFiring[] } => {
  const firings: MemoryFiring[] = [];

  return {
    countFirings: (ownerId, since) => {
      const mine = firings.filter(
        (firing) => firing.ownerId === ownerId && firing.firedAt >= since,
      );

      return Promise.resolve({
        auto: mine.filter((firing) => firing.autoSent).length,
        total: mine.length,
      });
    },
    firings,
    hasRecentFiring: (ruleId, entityId, since) =>
      Promise.resolve(
        firings.some(
          (firing) =>
            firing.ruleId === ruleId &&
            firing.entityId === entityId &&
            firing.firedAt >= since,
        ),
      ),
    listEnabledRules: (ownerId, trigger) =>
      Promise.resolve(
        rules.filter(
          (rule) =>
            rule.ownerId === ownerId &&
            rule.enabled &&
            (trigger === undefined || rule.trigger === trigger),
        ),
      ),
    recordFiring: (input) => {
      firings.push({ ...input, firedAt: new Date() });

      return Promise.resolve();
    },
  };
};

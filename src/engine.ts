import type { RuleStore, StoredRule } from "./store";
import type { RuleSignal, RuleVocabulary } from "./vocabulary";

/**
 * The firing engine: evaluates one trigger occurrence against an owner's
 * enabled rules, enforcing the guardrails that make member automations safe
 * to leave unattended — per-entity cooldown (via the firing ledger), daily
 * firing + auto-execution caps, a kill switch, and the host's authoring
 * policy re-checked at FIRE time (a rule authored under an older, looser
 * policy can't outrun a tightened one).
 *
 * The host supplies `executeAction`: given the rule and the occurrence, DO
 * the thing (queue a draft for approval, create a task, notify…) and return
 * an outcome string. Outcomes starting with "skipped" are not recorded, so
 * a skipped occurrence can retry later; anything else lands in the ledger
 * and counts toward the caps.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type RuleFireEvent<TTrigger extends string = string> = {
  trigger: TTrigger;
  /** Dedupe key for the occurrence (match id, task id, room+day…). */
  entityId: string;
  /** Short human context ("Brendan viewed your deal room twice today"). */
  context: string;
  /** Raw values the trigger's `matches` predicate checks params against. */
  signal?: RuleSignal;
};

export type RuleFirePolicy = {
  /** Master off switch — nothing fires while true. */
  killSwitch: boolean;
  /** Days a rule waits before re-firing for the SAME entity. */
  cooldownDays: number;
  /** Owner's recorded firings per day, all outcomes. */
  maxFiringsPerDay: number;
  /** Owner's auto-executions per day (the capped autopilot lane). */
  maxAutoPerDay: number;
  /** Authoring policy re-checked at fire time (host tier logic). */
  canUseAction: (action: string) => true | string;
  canAutoSend: (action: string) => true | string;
};

export type RuleExecuteOptions = {
  /** True when this firing may execute without a per-item approval. */
  autoSend: boolean;
  /** Human context from the occurrence. */
  context: string;
};

export type RuleEngine<
  TTrigger extends string = string,
  TAction extends string = string,
> = {
  /** Evaluate one occurrence. Returns the outcome per evaluated rule. */
  fire: (
    ownerId: string,
    event: RuleFireEvent<TTrigger>,
    policy: RuleFirePolicy,
  ) => Promise<string[]>;
};

export const createRuleEngine = <
  TTrigger extends string,
  TAction extends string,
>(options: {
  vocabulary: RuleVocabulary<TTrigger, TAction>;
  store: RuleStore<TTrigger, TAction>;
  executeAction: (
    rule: StoredRule<TTrigger, TAction>,
    event: RuleFireEvent<TTrigger>,
    execute: RuleExecuteOptions,
  ) => Promise<string>;
}): RuleEngine<TTrigger, TAction> => {
  const { executeAction, store, vocabulary } = options;

  const startOfToday = () => {
    const now = new Date();

    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };

  const evaluateRule = async (
    rule: StoredRule<TTrigger, TAction>,
    event: RuleFireEvent<TTrigger>,
    policy: RuleFirePolicy,
  ) => {
    const usable = policy.canUseAction(rule.action);
    if (usable !== true) return "skipped:policy";
    const definition = vocabulary.triggers[event.trigger];
    if (
      definition.matches &&
      !definition.matches(rule.triggerParams, event.signal ?? {})
    ) {
      return "skipped:params";
    }
    const cooldownSince = new Date(
      Date.now() - policy.cooldownDays * MS_PER_DAY,
    );
    if (await store.hasRecentFiring(rule.id, event.entityId, cooldownSince)) {
      return "skipped:cooldown";
    }
    const counts = await store.countFirings(rule.ownerId, startOfToday());
    if (counts.total >= policy.maxFiringsPerDay) {
      return "skipped:daily-cap";
    }
    const autoSend =
      rule.autoSend &&
      policy.canAutoSend(rule.action) === true &&
      counts.auto < policy.maxAutoPerDay;
    const outcome = await executeAction(rule, event, {
      autoSend,
      context: event.context,
    }).catch(() => "skipped:error");
    if (!outcome.startsWith("skipped")) {
      await store
        .recordFiring({
          autoSent: autoSend,
          entityId: event.entityId,
          outcome,
          ownerId: rule.ownerId,
          ruleId: rule.id,
        })
        .catch(() => undefined);
    }

    return outcome;
  };

  return {
    fire: async (ownerId, event, policy) => {
      if (policy.killSwitch) return [];
      const rules = await store.listEnabledRules(ownerId, event.trigger);
      // Sequential on purpose: each evaluation reads the caps the
      // previous one may have consumed.
      return rules.reduce(async (prev: Promise<string[]>, rule) => {
        const outcomes = await prev;
        const outcome = await evaluateRule(rule, event, policy);

        return [...outcomes, outcome];
      }, Promise.resolve([]));
    },
  };
};

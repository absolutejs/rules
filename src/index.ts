/**
 * `@absolutejs/rules` — typed standing automations ("if X do Y") for AI-agent
 * products, safe for the AGENT ITSELF to author.
 *
 * The host defines a CLOSED vocabulary of triggers and actions once
 * ({@link defineRuleVocabulary}); from it the package derives the validator
 * ({@link validateRuleInput} — clamps, strips, tier policy), the AI tool
 * schemas ({@link ruleToolSchemas} — enum'd so an LLM cannot hallucinate a
 * rule the engine doesn't run), and the firing engine
 * ({@link createRuleEngine} — per-entity cooldown, daily firing +
 * auto-execution caps, kill switch, policy re-checked at fire time). Storage
 * is pluggable ({@link RuleStore}); {@link createMemoryRuleStore} ships for
 * tests.
 */

export {
  createRuleEngine,
  type RuleEngine,
  type RuleExecuteOptions,
  type RuleFireEvent,
  type RuleFirePolicy,
} from "./engine";
export {
  createMemoryRuleStore,
  type FiringCounts,
  type RuleStore,
  type StoredRule,
} from "./store";
export { ruleToolSchemas, type RuleToolSchemas } from "./tools";
export {
  cleanRuleParams,
  RULE_GUIDANCE_MAX_CHARS,
  validateRuleInput,
  type RuleInput,
  type RulePolicy,
  type RuleValidation,
  type ValidatedRule,
} from "./validate";
export {
  defineRuleVocabulary,
  type RuleActionDefinition,
  type RuleParams,
  type RuleParamSpec,
  type RuleSignal,
  type RuleTriggerDefinition,
  type RuleVocabulary,
} from "./vocabulary";

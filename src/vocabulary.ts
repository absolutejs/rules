/**
 * The vocabulary is the contract: a CLOSED set of typed triggers and actions
 * the host's engine actually implements. One definition drives everything —
 * the validator, the AI tool schemas (so an LLM can author rules without
 * being able to hallucinate one), and the form spec a UI renders. The only
 * free text a rule may carry is `guidance`, a bounded style note the host
 * applies to generated copy; it never selects behavior.
 */

/** A typed parameter on a trigger/action. Numbers CLAMP to [min, max] rather
 *  than reject, so a near-miss from an LLM lands on the nearest sane value;
 *  strings with `values` narrow to the closed set (reject otherwise). */
export type RuleParamSpec =
  | {
      type: "number";
      min: number;
      max: number;
      /** Applied when the param is absent/invalid. Omit = param optional. */
      defaultValue?: number;
      description?: string;
    }
  | {
      type: "string";
      maxChars?: number;
      /** Closed set — values outside it reject (never clamp semantics). */
      values?: readonly string[];
      description?: string;
    };

export type RuleParams = Record<string, number | string>;

/** The raw values a trigger occurrence carries, checked against the rule's
 *  params by the trigger's `matches` predicate. */
export type RuleSignal = Record<string, number | string | undefined>;

export type RuleTriggerDefinition = {
  /** Human label ("A partner views my deal room repeatedly"). */
  label: string;
  /** Plain-English param note surfaced in tool descriptions and UIs. */
  paramsHelp: string;
  params?: Record<string, RuleParamSpec>;
  /** Should a rule with these params fire for this occurrence? Omitted =
   *  always fire (the host's wiring already scoped the occurrence). */
  matches?: (params: RuleParams, signal: RuleSignal) => boolean;
};

export type RuleActionDefinition = {
  label: string;
  paramsHelp: string;
  params?: Record<string, RuleParamSpec>;
  /** Capability tag the author must hold (host-defined semantics — e.g.
   *  "outbound" gated by a reputation tier). Omitted = always authorable. */
  capability?: string;
};

export type RuleVocabulary<
  TTrigger extends string = string,
  TAction extends string = string,
> = {
  triggers: Record<TTrigger, RuleTriggerDefinition>;
  actions: Record<TAction, RuleActionDefinition>;
  triggerNames: readonly TTrigger[];
  actionNames: readonly TAction[];
  /** One-line vocabulary summary for tool descriptions. */
  help: string;
};

export const defineRuleVocabulary = <
  TTrigger extends string,
  TAction extends string,
>(definition: {
  triggers: Record<TTrigger, RuleTriggerDefinition>;
  actions: Record<TAction, RuleActionDefinition>;
}): RuleVocabulary<TTrigger, TAction> => {
  const triggerNames = Object.keys(definition.triggers).sort() as TTrigger[];
  const actionNames = Object.keys(definition.actions).sort() as TAction[];
  const help = [
    "Triggers: ",
    triggerNames
      .map((name) => `${name} (${definition.triggers[name].paramsHelp})`)
      .join("; "),
    ". Actions: ",
    actionNames
      .map((name) => `${name} (${definition.actions[name].paramsHelp})`)
      .join("; "),
  ].join("");

  return {
    actionNames,
    actions: definition.actions,
    help,
    triggerNames,
    triggers: definition.triggers,
  };
};

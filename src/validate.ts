import type { RuleParams, RuleParamSpec, RuleVocabulary } from "./vocabulary";

/**
 * The single validation funnel every entry point (AI tool, REST endpoint,
 * anything future) runs rule input through. Unknown triggers/actions reject
 * with the available options spelled out (the message is written to be
 * relayed verbatim by an LLM); unknown params are stripped; numbers clamp;
 * closed-set strings narrow. A stored rule can therefore never carry
 * behavior the engine doesn't implement, no matter who authored it.
 */

export const RULE_GUIDANCE_MAX_CHARS = 280;

export type RuleInput = {
  trigger: string;
  action: string;
  triggerParams?: unknown;
  actionParams?: unknown;
  guidance?: string | null;
  autoSend?: boolean;
};

export type ValidatedRule<
  TTrigger extends string = string,
  TAction extends string = string,
> = {
  trigger: TTrigger;
  action: TAction;
  triggerParams: RuleParams;
  actionParams: RuleParams;
  guidance: string | null;
  autoSend: boolean;
};

/** Host-defined authoring policy (e.g. a reputation tier): return true to
 *  allow, or the human-readable refusal the author should see. */
export type RulePolicy = {
  canUseAction: (action: string) => true | string;
  canAutoSend: (action: string) => true | string;
};

export type RuleValidation<
  TTrigger extends string = string,
  TAction extends string = string,
> =
  | { ok: ValidatedRule<TTrigger, TAction>; error?: undefined }
  | { ok?: undefined; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const cleanNumberParam = (
  spec: Extract<RuleParamSpec, { type: "number" }>,
  raw: unknown,
) => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.min(Math.max(Math.round(raw), spec.min), spec.max);
  }

  return spec.defaultValue;
};

const cleanStringParam = (
  spec: Extract<RuleParamSpec, { type: "string" }>,
  raw: unknown,
) => {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const trimmed = raw.trim();
  if (spec.values) {
    return spec.values.find((value) => value === trimmed);
  }

  return spec.maxChars ? trimmed.slice(0, spec.maxChars) : trimmed;
};

/** Narrow raw params to the spec: unknown keys strip, numbers clamp, closed
 *  strings narrow, defaults fill. Never throws. */
export const cleanRuleParams = (
  specs: Record<string, RuleParamSpec> | undefined,
  raw: unknown,
): RuleParams => {
  if (!specs) return {};
  const input = isRecord(raw) ? raw : {};
  const params: RuleParams = {};
  for (const [key, spec] of Object.entries(specs)) {
    const value =
      spec.type === "number"
        ? cleanNumberParam(spec, input[key])
        : cleanStringParam(spec, input[key]);
    if (value !== undefined) params[key] = value;
  }

  return params;
};

export const validateRuleInput = <
  TTrigger extends string,
  TAction extends string,
>(
  vocabulary: RuleVocabulary<TTrigger, TAction>,
  input: RuleInput,
  policy: RulePolicy,
): RuleValidation<TTrigger, TAction> => {
  const trigger = vocabulary.triggerNames.find(
    (name) => name === input.trigger,
  );
  if (!trigger) {
    return {
      error: `Unknown trigger "${input.trigger}". Available: ${vocabulary.triggerNames.join(", ")}.`,
    };
  }
  const action = vocabulary.actionNames.find((name) => name === input.action);
  if (!action) {
    return {
      error: `Unknown action "${input.action}". Available: ${vocabulary.actionNames.join(", ")}.`,
    };
  }
  const usable = policy.canUseAction(action);
  if (usable !== true) return { error: usable };
  const autoSend = input.autoSend === true;
  if (autoSend) {
    const allowed = policy.canAutoSend(action);
    if (allowed !== true) return { error: allowed };
  }
  const guidance =
    typeof input.guidance === "string" && input.guidance.trim().length > 0
      ? input.guidance.trim().slice(0, RULE_GUIDANCE_MAX_CHARS)
      : null;

  return {
    ok: {
      action,
      actionParams: cleanRuleParams(
        vocabulary.actions[action].params,
        input.actionParams,
      ),
      autoSend,
      guidance,
      trigger,
      triggerParams: cleanRuleParams(
        vocabulary.triggers[trigger].params,
        input.triggerParams,
      ),
    },
  };
};

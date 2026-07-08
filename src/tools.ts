import { RULE_GUIDANCE_MAX_CHARS } from "./validate";
import type { RuleParamSpec, RuleVocabulary } from "./vocabulary";

/**
 * AI tool schemas derived from the vocabulary — the hallucination-proofing.
 * The trigger/action fields are ENUMS of the closed vocabulary and the param
 * schemas carry each spec's bounds and descriptions, so an LLM authoring a
 * rule can only produce input the validator accepts (and a near-miss gets a
 * relayable error naming the available options). The host wires these
 * schemas into its own tool registry with its own handlers.
 */

type JsonSchema = Record<string, unknown>;

const paramSchema = (spec: RuleParamSpec): JsonSchema => {
  if (spec.type === "number") {
    return {
      ...(spec.description ? { description: spec.description } : {}),
      maximum: spec.max,
      minimum: spec.min,
      type: "number",
    };
  }

  return {
    ...(spec.description ? { description: spec.description } : {}),
    ...(spec.values ? { enum: [...spec.values] } : {}),
    type: "string",
  };
};

const paramsObjectSchema = (
  specs: Record<string, Record<string, RuleParamSpec> | undefined>,
): JsonSchema => {
  const merged: Record<string, JsonSchema> = {};
  for (const params of Object.values(specs)) {
    for (const [key, spec] of Object.entries(params ?? {})) {
      merged[key] = paramSchema(spec);
    }
  }

  return { properties: merged, type: "object" };
};

export type RuleToolSchemas = {
  /** Input schema for a create_rule tool (trigger+action required). */
  createInput: JsonSchema;
  /** Input schema for an update_rule tool (everything optional + ruleId,
   *  enabled). */
  updateInput: JsonSchema;
  /** One-line vocabulary help to embed in the tool description. */
  help: string;
};

export const ruleToolSchemas = (
  vocabulary: RuleVocabulary,
): RuleToolSchemas => {
  const triggerParams = paramsObjectSchema(
    Object.fromEntries(
      vocabulary.triggerNames.map((name) => [
        name,
        vocabulary.triggers[name]?.params,
      ]),
    ),
  );
  const actionParams = paramsObjectSchema(
    Object.fromEntries(
      vocabulary.actionNames.map((name) => [
        name,
        vocabulary.actions[name]?.params,
      ]),
    ),
  );
  const shared = {
    action: { enum: [...vocabulary.actionNames], type: "string" },
    actionParams: {
      ...actionParams,
      description: "Typed params for the chosen action",
    },
    autoSend: {
      description:
        "Execute without a per-item approval tap (host policy gates this; stays capped daily)",
      type: "boolean",
    },
    guidance: {
      description: `Optional styling for generated copy, ≤${RULE_GUIDANCE_MAX_CHARS} chars — tone/length/framing only, never behavior`,
      type: "string",
    },
    trigger: { enum: [...vocabulary.triggerNames], type: "string" },
    triggerParams: {
      ...triggerParams,
      description: "Typed params for the chosen trigger",
    },
  };

  return {
    createInput: {
      properties: shared,
      required: ["trigger", "action"],
      type: "object",
    },
    help: vocabulary.help,
    updateInput: {
      properties: {
        ...shared,
        enabled: { type: "boolean" },
        ruleId: {
          description: "The rule id to update",
          type: "string",
        },
      },
      required: ["ruleId"],
      type: "object",
    },
  };
};

import {
  defineImplementation,
  defineManifest,
  toolFactory,
} from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import type { RuleFirePolicy } from "./engine";
import type { RuleStore } from "./store";

const tool = toolFactory<RuleStore>();

const MAX_COOLDOWN_DAYS = 365;
const MAX_DAILY_CAP = 1000;

/* The engine's constructor options (vocabulary, store, executeAction) are all
 * function-or-instance-valued → wiring concerns. The serializable knobs live
 * on RuleFirePolicy — the guardrails passed to every fire() — so settings are
 * drift-checked against it and the default recipe assembles the policy
 * object. The store is the one pluggable position (`rules/store`). */
export const manifest = defineManifest<RuleFirePolicy, RuleStore>()({
  contract: 2,
  identity: {
    accent: "#f97316",
    category: "ai",
    description:
      "Typed standing automations for AI-agent products, safe for the agent itself to author. A closed trigger/action vocabulary drives the validator (clamps, strips, tier policy), the LLM tool schemas (enum'd so a rule the engine doesn't run cannot be authored), and a firing engine with per-entity cooldown, daily firing + auto-execution caps, and a kill switch.",
    docsUrl: "https://github.com/absolutejs/rules",
    name: "@absolutejs/rules",
    tagline: "Set up if-this-then-that automations.",
  },
  implements: [
    defineImplementation<never>()({
      contract: "rules/store",
      factory: "createMemoryRuleStore",
      from: "@absolutejs/rules",
      title: "In memory (development only — rules reset on restart)",
      wiring: {
        code: "createMemoryRuleStore([])",
        imports: [
          { from: "@absolutejs/rules", names: ["createMemoryRuleStore"] },
        ],
      },
    }),
  ],
  settings: Type.Object({
    cooldownDays: Type.Optional(
      Type.Number({
        description:
          "How many days a rule waits before firing again for the same thing. Default is 3.",
        maximum: MAX_COOLDOWN_DAYS,
        minimum: 0,
        title: "Wait between repeats (days)",
      }),
    ),
    killSwitch: Type.Optional(
      Type.Boolean({
        description:
          "Turn on to pause every automation at once. Nothing fires while this is on.",
        title: "Pause all automations",
      }),
    ),
    maxAutoPerDay: Type.Optional(
      Type.Number({
        description:
          "How many actions may run automatically (without approval) per person per day. Default is 3.",
        maximum: MAX_DAILY_CAP,
        minimum: 0,
        title: "Automatic actions per day",
      }),
    ),
    maxFiringsPerDay: Type.Optional(
      Type.Number({
        description:
          "How many times automations may fire per person per day, approvals included. Default is 10.",
        maximum: MAX_DAILY_CAP,
        minimum: 0,
        title: "Automation firings per day",
      }),
    ),
  }),
  slots: {
    store: {
      configPath: "$self",
      contract: "rules/store",
      description: "Where rules and their firing history are kept",
      known: ["@absolutejs/rules#memory"],
      required: true,
    },
  },
  tools: {
    list_rules: tool.runtime({
      annotations: { readOnlyHint: true },
      authorization: {
        approval: "never",
        audience: "owner",
        effects: ["read"],
        requiredScopes: ["rules:read"],
        resource: {
          idField: "ownerId",
          ownerIdField: "ownerId",
          type: "rules-owner",
        },
      },
      description:
        "List one person's enabled automation rules, optionally narrowed to a single trigger. Returns each rule's trigger, action, params, and auto-send flag.",
      handler: async ({ ownerId, trigger }, store) =>
        JSON.stringify(await store.listEnabledRules(ownerId, trigger)),
      input: Type.Object({
        ownerId: Type.String({ minLength: 1 }),
        trigger: Type.Optional(Type.String({ minLength: 1 })),
      }),
    }),
  },
  wiring: [
    {
      description:
        "Define the closed vocabulary of triggers and actions, pick a store, and create the engine — fire occurrences from your own hooks with the configured guardrails.",
      id: "default",
      server: {
        code: [
          "// The vocabulary is the contract: a CLOSED set of triggers and",
          "// actions your engine implements. The validator, the AI tool",
          "// schemas (ruleToolSchemas), and the engine all derive from it.",
          "const vocabulary = defineRuleVocabulary({",
          "\t// TODO: replace the examples with your real triggers and actions.",
          "\tactions: {",
          "\t\tdraft_followup: {",
          "\t\t\tlabel: 'Draft a follow-up for my approval',",
          "\t\t\tparamsHelp: 'none'",
          "\t\t}",
          "\t},",
          "\ttriggers: {",
          "\t\tno_reply: {",
          "\t\t\tlabel: 'My outreach gets no reply',",
          "\t\t\tparams: {",
          "\t\t\t\tdays: { defaultValue: 4, max: 30, min: 1, type: 'number' }",
          "\t\t\t},",
          "\t\t\tparamsHelp: 'days (default 4)'",
          "\t\t}",
          "\t}",
          "});",
          "",
          "const ruleStore = ${slot.store};",
          "",
          "const ruleEngine = createRuleEngine({",
          "\t// TODO: do the action (queue a draft for approval, create a task,",
          "\t// notify…) and return an outcome string.",
          "\texecuteAction: async (rule, event, { autoSend }) =>",
          "\t\tautoSend ? 'executed' : 'drafted',",
          "\tstore: ruleStore,",
          "\tvocabulary",
          "});",
          "",
          "// Fire occurrences from your signal hooks and sweeps:",
          "//   await ruleEngine.fire(ownerId, { trigger, entityId, context }, rulePolicy);",
          "const rulePolicy = {",
          "\t// TODO: re-check your authoring policy at fire time (tiers, roles).",
          "\tcanAutoSend: () => true,",
          "\tcanUseAction: () => true,",
          "\tcooldownDays: ${settings.cooldownDays} ?? 3,",
          "\tkillSwitch: ${settings.killSwitch} ?? false,",
          "\tmaxAutoPerDay: ${settings.maxAutoPerDay} ?? 3,",
          "\tmaxFiringsPerDay: ${settings.maxFiringsPerDay} ?? 10",
          "};",
        ].join("\n"),
        imports: [
          {
            from: "@absolutejs/rules",
            names: ["createRuleEngine", "defineRuleVocabulary"],
          },
        ],
        placement: "module-scope",
      },
      title: "Define the vocabulary and start the engine",
    },
  ],
});

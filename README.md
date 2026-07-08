# @absolutejs/rules

Typed standing automations ("if X do Y") for AI-agent products — safe for the
**agent itself** to author.

Built for the AbsoluteJS AI Studio.

## The idea

Letting an LLM create automations on a member's behalf is only safe if the
rule language is closed. This package makes the vocabulary the contract: you
define your triggers and actions **once**, with typed, bounded parameters, and
everything derives from that single definition —

- **The validator** (`validateRuleInput`): unknown triggers/actions reject with
  the available options spelled out (an error the LLM can relay verbatim),
  unknown params strip, numbers clamp to their bounds, closed-set strings
  narrow. A stored rule can never carry behavior your engine doesn't implement.
- **The AI tool schemas** (`ruleToolSchemas`): create/update tool inputs whose
  trigger/action fields are enums of your vocabulary — the hallucination-proofing.
- **The firing engine** (`createRuleEngine`): per-entity cooldown via a firing
  ledger, daily firing + auto-execution caps, a kill switch, and your authoring
  policy re-checked at fire time (a rule authored under a looser policy can't
  outrun a tightened one).

The only free text a rule carries is `guidance` — a bounded style note your
drafting pipeline applies to generated copy. It never selects behavior.

## Quick start

```ts
import {
  createMemoryRuleStore,
  createRuleEngine,
  defineRuleVocabulary,
  ruleToolSchemas,
  validateRuleInput,
} from "@absolutejs/rules";

const vocabulary = defineRuleVocabulary({
  triggers: {
    no_reply: {
      label: "My outreach gets no reply",
      paramsHelp: "days (default 4)",
      params: { days: { type: "number", min: 1, max: 30, defaultValue: 4 } },
    },
  },
  actions: {
    draft_followup: {
      label: "Draft a follow-up for my approval",
      paramsHelp: "none (guidance styles the copy)",
      capability: "outbound",
    },
  },
});

// 1. Validate anything that wants to become a rule (AI tool, REST, forms):
const result = validateRuleInput(
  vocabulary,
  {
    trigger: "no_reply",
    action: "draft_followup",
    triggerParams: { days: 45 },
  },
  {
    canUseAction: (action) =>
      memberTier !== "restricted" || "Outbound rules need a higher score.",
    canAutoSend: () =>
      memberTier === "trusted" || "Auto-send needs the trusted tier.",
  },
);
// result.ok.triggerParams.days === 30 (clamped)

// 2. Give your agent the tools (schemas only — you own the handlers):
const { createInput, updateInput, help } = ruleToolSchemas(vocabulary);

// 3. Fire occurrences from your signal hooks / sweeps:
const engine = createRuleEngine({
  vocabulary,
  store, // your RuleStore (drizzle, memory, …)
  executeAction: async (rule, event, { autoSend }) => {
    // queue a draft for approval, create a task, auto-execute…
    return autoSend ? "executed" : "drafted";
  },
});

await engine.fire(
  ownerId,
  {
    trigger: "no_reply",
    entityId: `noreply:${matchId}`,
    context: "no reply from Brendan in 5 days",
    signal: { days: 5 },
  },
  {
    killSwitch: false,
    cooldownDays: 3,
    maxFiringsPerDay: 10,
    maxAutoPerDay: 3,
    canUseAction: () => true,
    canAutoSend: () => true,
  },
);
```

Storage is pluggable via the small `RuleStore` interface (list enabled rules,
ledger reads/writes). `createMemoryRuleStore` ships for tests; a drizzle/
Postgres store is a few lines against your own tables (see the onSpark
reference integration).

## License

Business Source License 1.1 — free for your own products and internal use;
you may not offer it as a competing hosted automation/rules service. Converts
to Apache 2.0 on July 8, 2030. See [LICENSE](./LICENSE).

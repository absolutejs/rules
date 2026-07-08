import { describe, expect, test } from "bun:test";
import { createRuleEngine } from "../src/engine";
import { createMemoryRuleStore, type StoredRule } from "../src/store";
import { ruleToolSchemas } from "../src/tools";
import { validateRuleInput, type RulePolicy } from "../src/validate";
import { defineRuleVocabulary } from "../src/vocabulary";

const vocabulary = defineRuleVocabulary({
  actions: {
    create_task: {
      label: "Create a task",
      params: {
        dueInDays: {
          defaultValue: 3,
          max: 30,
          min: 1,
          type: "number",
        },
      },
      paramsHelp: "dueInDays (default 3)",
    },
    draft_followup: {
      capability: "outbound",
      label: "Draft a follow-up for approval",
      paramsHelp: "none",
    },
  },
  triggers: {
    deal_room_viewed: {
      label: "Deal room viewed repeatedly",
      matches: (params, signal) =>
        (typeof signal.viewsToday === "number" ? signal.viewsToday : 0) >=
        (typeof params.viewsInDay === "number" ? params.viewsInDay : 2),
      params: {
        viewsInDay: {
          defaultValue: 2,
          max: 10,
          min: 1,
          type: "number",
        },
      },
      paramsHelp: "viewsInDay (default 2)",
    },
    no_reply: {
      label: "No reply to outreach",
      params: {
        days: { defaultValue: 4, max: 30, min: 1, type: "number" },
      },
      paramsHelp: "days (default 4)",
    },
  },
});

const openPolicy: RulePolicy = {
  canAutoSend: () => true,
  canUseAction: () => true,
};

describe("validateRuleInput", () => {
  test("accepts a valid rule, clamps + defaults params, bounds guidance", () => {
    const result = validateRuleInput(
      vocabulary,
      {
        action: "create_task",
        actionParams: { dueInDays: 99, junk: "stripped" },
        guidance: `  ${"x".repeat(400)}  `,
        trigger: "no_reply",
        triggerParams: {},
      },
      openPolicy,
    );
    expect(result.ok).toBeDefined();
    expect(result.ok?.actionParams.dueInDays).toBe(30);
    expect(result.ok?.triggerParams.days).toBe(4);
    expect(result.ok?.actionParams.junk).toBeUndefined();
    expect(result.ok?.guidance?.length).toBe(280);
  });

  test("rejects unknown triggers/actions naming the vocabulary", () => {
    const result = validateRuleInput(
      vocabulary,
      { action: "create_task", trigger: "made_up" },
      openPolicy,
    );
    expect(result.error).toContain('Unknown trigger "made_up"');
    expect(result.error).toContain("deal_room_viewed, no_reply");
  });

  test("enforces the host policy for actions and autoSend", () => {
    const gated: RulePolicy = {
      canAutoSend: () => "Auto-send needs the trusted tier.",
      canUseAction: (action) =>
        action === "draft_followup"
          ? "Outbound rules need a higher score."
          : true,
    };
    expect(
      validateRuleInput(
        vocabulary,
        { action: "draft_followup", trigger: "no_reply" },
        gated,
      ).error,
    ).toContain("higher score");
    expect(
      validateRuleInput(
        vocabulary,
        { action: "create_task", autoSend: true, trigger: "no_reply" },
        gated,
      ).error,
    ).toContain("trusted tier");
  });
});

describe("createRuleEngine", () => {
  const makeRule = (
    overrides: Partial<StoredRule<"deal_room_viewed" | "no_reply">>,
  ): StoredRule<
    "deal_room_viewed" | "no_reply",
    "create_task" | "draft_followup"
  > => ({
    action: "draft_followup",
    actionParams: {},
    autoSend: false,
    enabled: true,
    guidance: null,
    id: "rule-1",
    ownerId: "owner-1",
    trigger: "deal_room_viewed",
    triggerParams: { viewsInDay: 2 },
    ...overrides,
  });

  const policy = {
    canAutoSend: () => true as const,
    canUseAction: () => true as const,
    cooldownDays: 3,
    killSwitch: false,
    maxAutoPerDay: 1,
    maxFiringsPerDay: 2,
  };

  test("fires matching rules once per entity (cooldown), honors caps", async () => {
    const store = createMemoryRuleStore([makeRule({})]);
    const executed: boolean[] = [];
    const engine = createRuleEngine({
      executeAction: (rule, event, options) => {
        executed.push(options.autoSend);

        return Promise.resolve("drafted");
      },
      store,
      vocabulary,
    });
    const event = {
      context: "viewed twice",
      entityId: "room-1:today",
      signal: { viewsToday: 2 },
      trigger: "deal_room_viewed" as const,
    };
    expect(await engine.fire("owner-1", event, policy)).toEqual(["drafted"]);
    // Same entity again → cooldown skip, nothing executed.
    expect(await engine.fire("owner-1", event, policy)).toEqual([
      "skipped:cooldown",
    ]);
    expect(executed).toHaveLength(1);
    // New entities → second fires, third hits the daily cap.
    await engine.fire(
      "owner-1",
      { ...event, entityId: "room-2:today" },
      policy,
    );
    expect(
      await engine.fire(
        "owner-1",
        { ...event, entityId: "room-3:today" },
        policy,
      ),
    ).toEqual(["skipped:daily-cap"]);
  });

  test("trigger params gate firing; kill switch stops everything", async () => {
    const store = createMemoryRuleStore([
      makeRule({ triggerParams: { viewsInDay: 3 } }),
    ]);
    const engine = createRuleEngine({
      executeAction: () => Promise.resolve("drafted"),
      store,
      vocabulary,
    });
    const event = {
      context: "viewed twice",
      entityId: "room-1",
      signal: { viewsToday: 2 },
      trigger: "deal_room_viewed" as const,
    };
    expect(await engine.fire("owner-1", event, policy)).toEqual([
      "skipped:params",
    ]);
    expect(
      await engine.fire("owner-1", event, {
        ...policy,
        killSwitch: true,
      }),
    ).toEqual([]);
  });

  test("autoSend needs the rule flag, policy, and the auto cap", async () => {
    const store = createMemoryRuleStore([
      makeRule({ autoSend: true, id: "rule-auto" }),
    ]);
    const seen: boolean[] = [];
    const engine = createRuleEngine({
      executeAction: (rule, event, options) => {
        seen.push(options.autoSend);

        return Promise.resolve("executed");
      },
      store,
      vocabulary,
    });
    const base = {
      context: "viewed",
      signal: { viewsToday: 2 },
      trigger: "deal_room_viewed" as const,
    };
    await engine.fire("owner-1", { ...base, entityId: "e1" }, policy);
    // maxAutoPerDay 1 → the second firing downgrades to approval.
    await engine.fire("owner-1", { ...base, entityId: "e2" }, policy);
    expect(seen).toEqual([true, false]);
  });
});

describe("ruleToolSchemas", () => {
  test("enumerates the closed vocabulary with param bounds", () => {
    const schemas = ruleToolSchemas(vocabulary);
    const create = JSON.stringify(schemas.createInput);
    expect(create).toContain('"enum":["create_task","draft_followup"]');
    expect(create).toContain('"enum":["deal_room_viewed","no_reply"]');
    expect(create).toContain('"maximum":30');
    expect(schemas.help).toContain("no_reply (days (default 4))");
    const update = JSON.stringify(schemas.updateInput);
    expect(update).toContain('"ruleId"');
  });
});

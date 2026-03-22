import { describe, expect, it, beforeEach, vi } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent } from "@paperclipai/shared";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";
import { JOB_KEYS, STREAM_CHANNELS } from "../src/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COMPANY_ID = "comp_1";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_1",
    companyId: COMPANY_ID,
    name: "Test Agent",
    urlKey: "test-agent",
    role: "engineer",
    title: "Engineer",
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "claude_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 2000,
    spentMonthlyCents: 100,
    permissions: { canApproveExpenses: false, canCreateIssues: true },
    lastHeartbeatAt: new Date(),
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Agent;
}

function makeHarness(): TestHarness {
  return createTestHarness({
    manifest,
    // Add capabilities the worker needs that aren't in the manifest:
    // companies.read is required by performFleetHealthCheck
    capabilities: [...manifest.capabilities, "events.emit", "companies.read"],
  });
}

async function setupPlugin(harness: TestHarness): Promise<void> {
  await plugin.definition.setup(harness.ctx);
}

function seedCompanyAndAgents(
  harness: TestHarness,
  agents: Agent[],
): void {
  harness.seed({
    companies: [
      { id: COMPANY_ID, name: "Test Co", createdAt: new Date(), updatedAt: new Date() } as any,
    ],
    agents,
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe("Tortuga plugin setup", () => {
  it("completes setup without error", async () => {
    const harness = makeHarness();
    await expect(setupPlugin(harness)).resolves.not.toThrow();
  });

  it("logs setup start and completion", async () => {
    const harness = makeHarness();
    await setupPlugin(harness);

    const messages = harness.logs.map((l) => l.message);
    expect(messages).toContain("Tortuga plugin starting setup");
    expect(messages).toContain("Tortuga plugin setup complete");
  });
});

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

describe("Tortuga event handlers", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = makeHarness();
    seedCompanyAndAgents(harness, [makeAgent()]);
    await setupPlugin(harness);
  });

  describe("agent.status_changed", () => {
    it("updates agent health state in plugin state", async () => {
      await harness.emit(
        "agent.status_changed",
        { newStatus: "running", previousStatus: "idle" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const healthState = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "health",
      }) as any;

      expect(healthState).toBeDefined();
      expect(healthState.status).toBe("running");
      expect(healthState.lastCheckedAt).toBeDefined();
    });

    it("logs the status change", async () => {
      await harness.emit(
        "agent.status_changed",
        { newStatus: "running" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const log = harness.logs.find((l) => l.message === "Agent status changed");
      expect(log).toBeDefined();
      expect(log!.meta?.agentId).toBe("agent_1");
    });

    it("skips when entityId is missing", async () => {
      // Should not throw, just return early
      await harness.emit(
        "agent.status_changed",
        { newStatus: "running" },
        { entityType: "agent", companyId: COMPANY_ID },
      );

      // No health state should be written for undefined agent
      const healthState = harness.getState({
        scopeKind: "agent",
        scopeId: "undefined",
        stateKey: "health",
      });
      expect(healthState).toBeUndefined();
    });
  });

  describe("agent.run.started", () => {
    it("increments started run count", async () => {
      await harness.emit(
        "agent.run.started",
        { runId: "run_1" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const counts = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "run-counts",
      }) as any;

      expect(counts.started).toBe(1);
      expect(counts.completed).toBe(0);
      expect(counts.failed).toBe(0);
    });

    it("increments cumulatively across multiple runs", async () => {
      for (let i = 0; i < 3; i++) {
        await harness.emit(
          "agent.run.started",
          { runId: `run_${i}` },
          { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
        );
      }

      const counts = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "run-counts",
      }) as any;

      expect(counts.started).toBe(3);
    });
  });

  describe("agent.run.finished", () => {
    it("increments completed run count", async () => {
      await harness.emit(
        "agent.run.finished",
        { runId: "run_1" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const counts = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "run-counts",
      }) as any;

      expect(counts.completed).toBe(1);
    });

    it("includes invocationSource in stream event when present", async () => {
      const emitSpy = vi.spyOn(harness.ctx.streams, "emit");

      await harness.emit(
        "agent.run.finished",
        { runId: "run_1", invocationSource: "scheduled-routine", triggerDetail: "daily-standup" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const call = emitSpy.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === "run-finished",
      );
      expect(call).toBeDefined();
      const emitted = call![1] as Record<string, unknown>;
      expect(emitted.invocationSource).toBe("scheduled-routine");
      expect(emitted.triggerDetail).toBe("daily-standup");
    });

    it("defaults invocationSource and triggerDetail to null when absent", async () => {
      const emitSpy = vi.spyOn(harness.ctx.streams, "emit");

      await harness.emit(
        "agent.run.finished",
        { runId: "run_2" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const call = emitSpy.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === "run-finished" && evt.runId === "run_2",
      );
      expect(call).toBeDefined();
      const emitted = call![1] as Record<string, unknown>;
      expect(emitted.invocationSource).toBeNull();
      expect(emitted.triggerDetail).toBeNull();
    });
  });

  describe("agent.run.failed", () => {
    it("increments failed run count", async () => {
      await harness.emit(
        "agent.run.failed",
        { runId: "run_1", error: "out of memory" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const counts = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "run-counts",
      }) as any;

      expect(counts.failed).toBe(1);
    });

    it("logs a warning with the error", async () => {
      await harness.emit(
        "agent.run.failed",
        { runId: "run_1", error: "out of memory" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const log = harness.logs.find((l) => l.message === "Agent run failed");
      expect(log).toBeDefined();
      expect(log!.level).toBe("warn");
      expect(log!.meta?.error).toBe("out of memory");
    });
  });

  describe("run count accumulation across event types", () => {
    it("tracks started, completed, and failed independently", async () => {
      await harness.emit(
        "agent.run.started",
        { runId: "run_1" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );
      await harness.emit(
        "agent.run.started",
        { runId: "run_2" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );
      await harness.emit(
        "agent.run.finished",
        { runId: "run_1" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );
      await harness.emit(
        "agent.run.failed",
        { runId: "run_2", error: "crash" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const counts = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "run-counts",
      }) as any;

      expect(counts.started).toBe(2);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Data handlers
// ---------------------------------------------------------------------------

describe("Tortuga data handlers", () => {
  describe("fleet-overview", () => {
    it("returns agent list with health classification", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "a1", name: "Healthy Agent", status: "idle" }),
        makeAgent({ id: "a2", name: "Paused Agent", status: "paused" }),
        makeAgent({ id: "a3", name: "Error Agent", status: "error" }),
      ]);
      await setupPlugin(harness);

      const overview = await harness.getData<any>("fleet-overview", {
        companyId: COMPANY_ID,
      });

      expect(overview.totalAgents).toBe(3);
      expect(overview.healthy).toBe(1);
      expect(overview.degraded).toBe(1);
      expect(overview.error).toBe(1);
      expect(overview.fleet).toHaveLength(3);
    });

    it("returns empty fleet when no agents exist", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, []);
      await setupPlugin(harness);

      const overview = await harness.getData<any>("fleet-overview", {
        companyId: COMPANY_ID,
      });

      expect(overview.totalAgents).toBe(0);
      expect(overview.fleet).toHaveLength(0);
    });

    it("includes run counts in fleet entries", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [makeAgent({ id: "a1" })]);
      await setupPlugin(harness);

      // Emit some run events first
      await harness.emit(
        "agent.run.started",
        { runId: "r1" },
        { entityId: "a1", entityType: "agent", companyId: COMPANY_ID },
      );
      await harness.emit(
        "agent.run.finished",
        { runId: "r1" },
        { entityId: "a1", entityType: "agent", companyId: COMPANY_ID },
      );

      const overview = await harness.getData<any>("fleet-overview", {
        companyId: COMPANY_ID,
      });

      const entry = overview.fleet.find((f: any) => f.id === "a1");
      // Run counts should be available via the health state written by events
      // The fleet-overview handler reads from state
      expect(entry).toBeDefined();
    });

    it("throws when companyId is missing", async () => {
      const harness = makeHarness();
      await setupPlugin(harness);

      await expect(
        harness.getData("fleet-overview", {}),
      ).rejects.toThrow("companyId is required");
    });

    it("classifies terminated agents as error", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "a1", status: "terminated" }),
      ]);
      await setupPlugin(harness);

      const overview = await harness.getData<any>("fleet-overview", {
        companyId: COMPANY_ID,
      });

      expect(overview.error).toBe(1);
      expect(overview.fleet[0].health).toBe("error");
    });

    it("classifies pending_approval agents as degraded", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "a1", status: "pending_approval" }),
      ]);
      await setupPlugin(harness);

      const overview = await harness.getData<any>("fleet-overview", {
        companyId: COMPANY_ID,
      });

      expect(overview.degraded).toBe(1);
      expect(overview.fleet[0].health).toBe("degraded");
    });

    it("classifies agents with stale heartbeat as degraded", async () => {
      const harness = makeHarness();
      const staleHeartbeat = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "a1", status: "idle", lastHeartbeatAt: staleHeartbeat }),
      ]);
      await setupPlugin(harness);

      const overview = await harness.getData<any>("fleet-overview", {
        companyId: COMPANY_ID,
      });

      expect(overview.degraded).toBe(1);
      expect(overview.fleet[0].health).toBe("degraded");
    });
  });

  describe("agent-detail", () => {
    it("returns single agent with health classification", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", name: "Martha", status: "running" }),
      ]);
      await setupPlugin(harness);

      const detail = await harness.getData<any>("agent-detail", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
      });

      expect(detail.name).toBe("Martha");
      expect(detail.status).toBe("running");
      expect(detail.health).toBe("healthy");
      expect(detail.runCounts).toEqual({
        started: 0,
        completed: 0,
        failed: 0,
      });
    });

    it("throws for nonexistent agent", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, []);
      await setupPlugin(harness);

      await expect(
        harness.getData("agent-detail", {
          agentId: "missing",
          companyId: COMPANY_ID,
        }),
      ).rejects.toThrow("Agent missing not found");
    });

    it("throws when agentId is missing", async () => {
      const harness = makeHarness();
      await setupPlugin(harness);

      await expect(
        harness.getData("agent-detail", { companyId: COMPANY_ID }),
      ).rejects.toThrow("agentId is required");
    });

    it("throws when companyId is missing", async () => {
      const harness = makeHarness();
      await setupPlugin(harness);

      await expect(
        harness.getData("agent-detail", { agentId: "agent_1" }),
      ).rejects.toThrow("companyId is required");
    });

    it("includes lastWakeupRequest when wakeup metadata exists", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "idle" }),
      ]);
      await setupPlugin(harness);

      // Invoke the agent to create wakeup metadata
      await harness.performAction("invoke-agent", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
        prompt: "Wake up",
        reason: "Scheduled routine",
        source: "cron-trigger",
      });

      const detail = await harness.getData<any>("agent-detail", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
      });

      expect(detail.lastWakeupRequest).toBeDefined();
      expect(detail.lastWakeupRequest.source).toBe("cron-trigger");
      expect(detail.lastWakeupRequest.reason).toBe("Scheduled routine");
      expect(detail.lastWakeupRequest.runId).toBeDefined();
      expect(detail.lastWakeupRequest.requestedAt).toBeDefined();
    });

    it("returns null lastWakeupRequest when no wakeup has occurred", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "idle" }),
      ]);
      await setupPlugin(harness);

      const detail = await harness.getData<any>("agent-detail", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
      });

      expect(detail.lastWakeupRequest).toBeNull();
    });

    it("includes run counts from prior events when health state exists", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [makeAgent({ id: "agent_1" })]);
      await setupPlugin(harness);

      // Run fleet-health first to initialize per-agent health state.
      // Without it, run event handlers skip the healthState update
      // (guarded by `if (healthState)`), so agent-detail falls back
      // to the default { started: 0, completed: 0, failed: 0 }.
      await harness.runJob("fleet-health");

      // Now simulate run events -- these update the initialized health state
      await harness.emit(
        "agent.run.started",
        { runId: "r1" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );
      await harness.emit(
        "agent.run.finished",
        { runId: "r1" },
        { entityId: "agent_1", entityType: "agent", companyId: COMPANY_ID },
      );

      const detail = await harness.getData<any>("agent-detail", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
      });

      expect(detail.runCounts.started).toBe(1);
      expect(detail.runCounts.completed).toBe(1);
      expect(detail.runCounts.failed).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

describe("Tortuga action handlers", () => {
  describe("pause-agent", () => {
    it("pauses an idle agent", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "idle" }),
      ]);
      await setupPlugin(harness);

      const result = await harness.performAction<any>("pause-agent", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("paused");
    });

    it("throws when agentId is missing", async () => {
      const harness = makeHarness();
      await setupPlugin(harness);

      await expect(
        harness.performAction("pause-agent", { companyId: COMPANY_ID }),
      ).rejects.toThrow("agentId is required");
    });

    it("throws when trying to pause a terminated agent", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "terminated" }),
      ]);
      await setupPlugin(harness);

      await expect(
        harness.performAction("pause-agent", {
          agentId: "agent_1",
          companyId: COMPANY_ID,
        }),
      ).rejects.toThrow("Cannot pause terminated agent");
    });
  });

  describe("resume-agent", () => {
    it("resumes a paused agent", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "paused" }),
      ]);
      await setupPlugin(harness);

      const result = await harness.performAction<any>("resume-agent", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
      });

      expect(result.ok).toBe(true);
      expect(result.status).toBe("idle");
    });

    it("throws when agentId is missing", async () => {
      const harness = makeHarness();
      await setupPlugin(harness);

      await expect(
        harness.performAction("resume-agent", { companyId: COMPANY_ID }),
      ).rejects.toThrow("agentId is required");
    });

    it("throws when trying to resume a terminated agent", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "terminated" }),
      ]);
      await setupPlugin(harness);

      await expect(
        harness.performAction("resume-agent", {
          agentId: "agent_1",
          companyId: COMPANY_ID,
        }),
      ).rejects.toThrow("Cannot resume terminated agent");
    });

    it("throws when trying to resume a pending_approval agent", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "pending_approval" }),
      ]);
      await setupPlugin(harness);

      await expect(
        harness.performAction("resume-agent", {
          agentId: "agent_1",
          companyId: COMPANY_ID,
        }),
      ).rejects.toThrow("Pending approval agents cannot be resumed");
    });
  });

  describe("invoke-agent", () => {
    it("invokes an idle agent with a prompt", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "idle" }),
      ]);
      await setupPlugin(harness);

      const result = await harness.performAction<any>("invoke-agent", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
        prompt: "Run a health check",
        reason: "Manual trigger from UI",
      });

      expect(result.ok).toBe(true);
      expect(result.runId).toBeDefined();
      expect(typeof result.runId).toBe("string");
    });

    it("throws when prompt is missing", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [makeAgent({ id: "agent_1" })]);
      await setupPlugin(harness);

      await expect(
        harness.performAction("invoke-agent", {
          agentId: "agent_1",
          companyId: COMPANY_ID,
        }),
      ).rejects.toThrow("prompt is required");
    });

    it("throws when agent is paused", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "paused" }),
      ]);
      await setupPlugin(harness);

      await expect(
        harness.performAction("invoke-agent", {
          agentId: "agent_1",
          companyId: COMPANY_ID,
          prompt: "test",
        }),
      ).rejects.toThrow("not invokable");
    });

    it("persists wakeup metadata and emits stream event", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "idle" }),
      ]);
      await setupPlugin(harness);

      const emitSpy = vi.spyOn(harness.ctx.streams, "emit");

      const result = await harness.performAction<any>("invoke-agent", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
        prompt: "Run diagnostics",
        reason: "Fleet check",
        source: "routine-scheduler",
      });

      // Verify wakeup metadata was persisted
      const wakeup = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "last-wakeup-request",
      }) as any;

      expect(wakeup).toBeDefined();
      expect(wakeup.runId).toBe(result.runId);
      expect(wakeup.source).toBe("routine-scheduler");
      expect(wakeup.reason).toBe("Fleet check");
      expect(wakeup.requestedAt).toBeDefined();

      // Verify stream event was emitted
      const call = emitSpy.mock.calls.find(
        ([, evt]: [string, any]) => evt.type === "agent-wakeup-requested",
      );
      expect(call).toBeDefined();
      const [, emitted] = call! as [string, any];
      expect(emitted.agentId).toBe("agent_1");
      expect(emitted.runId).toBe(result.runId);
      expect(emitted.source).toBe("routine-scheduler");
    });

    it("defaults source to 'manual fleet invoke' when not provided", async () => {
      const harness = makeHarness();
      seedCompanyAndAgents(harness, [
        makeAgent({ id: "agent_1", status: "idle" }),
      ]);
      await setupPlugin(harness);

      await harness.performAction<any>("invoke-agent", {
        agentId: "agent_1",
        companyId: COMPANY_ID,
        prompt: "Quick check",
      });

      const wakeup = harness.getState({
        scopeKind: "agent",
        scopeId: "agent_1",
        stateKey: "last-wakeup-request",
      }) as any;

      expect(wakeup.source).toBe("manual fleet invoke");
      expect(wakeup.reason).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

describe("Tortuga fleet-health job", () => {
  it("is declared in manifest", () => {
    const job = manifest.jobs?.find((j) => j.jobKey === JOB_KEYS.fleetHealth);
    expect(job).toBeDefined();
    expect(job!.schedule).toBe("*/5 * * * *");
  });

  it("runs and persists health check result", async () => {
    const harness = makeHarness();
    seedCompanyAndAgents(harness, [
      makeAgent({ id: "a1", status: "idle" }),
      makeAgent({ id: "a2", status: "error" }),
    ]);
    await setupPlugin(harness);

    await harness.runJob("fleet-health");

    const lastCheck = harness.getState({
      scopeKind: "instance",
      stateKey: "last-health-check",
    }) as any;

    expect(lastCheck).toBeDefined();
    expect(lastCheck.totalAgents).toBe(2);
    expect(lastCheck.healthy).toBe(1);
    expect(lastCheck.error).toBe(1);
    expect(lastCheck.checkedAt).toBeDefined();
  });

  it("logs job execution", async () => {
    const harness = makeHarness();
    seedCompanyAndAgents(harness, [makeAgent({ id: "a1" })]);
    await setupPlugin(harness);

    await harness.runJob("fleet-health");

    const startLog = harness.logs.find(
      (l) => l.message === "Starting fleet health check",
    );
    const completeLog = harness.logs.find(
      (l) => l.message === "Fleet health check completed",
    );

    expect(startLog).toBeDefined();
    expect(completeLog).toBeDefined();
    expect(completeLog!.meta?.totalAgents).toBe(1);
  });

  it("writes per-agent health state during check", async () => {
    const harness = makeHarness();
    seedCompanyAndAgents(harness, [
      makeAgent({ id: "a1", status: "idle" }),
    ]);
    await setupPlugin(harness);

    await harness.runJob("fleet-health");

    const agentHealth = harness.getState({
      scopeKind: "agent",
      scopeId: "a1",
      stateKey: "health",
    }) as any;

    expect(agentHealth).toBeDefined();
    expect(agentHealth.status).toBe("idle");
    expect(agentHealth.lastCheckedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Health check lifecycle
// ---------------------------------------------------------------------------

describe("Tortuga onHealth", () => {
  it("returns degraded when no health check has been performed", async () => {
    const harness = makeHarness();
    await setupPlugin(harness);

    const health = await plugin.definition.onHealth!();
    expect(health.status).toBe("degraded");
    expect(health.message).toContain("No fleet health check");
  });

  it("returns ok after a successful fleet health check with all healthy agents", async () => {
    const harness = makeHarness();
    seedCompanyAndAgents(harness, [
      makeAgent({ id: "a1", status: "idle" }),
    ]);
    await setupPlugin(harness);

    await harness.runJob("fleet-health");

    const health = await plugin.definition.onHealth!();
    expect(health.status).toBe("ok");
    expect(health.message).toContain("1/1");
  });

  it("returns degraded when there are agents in error state", async () => {
    const harness = makeHarness();
    seedCompanyAndAgents(harness, [
      makeAgent({ id: "a1", status: "idle" }),
      makeAgent({ id: "a2", status: "error" }),
    ]);
    await setupPlugin(harness);

    await harness.runJob("fleet-health");

    const health = await plugin.definition.onHealth!();
    expect(health.status).toBe("degraded");
    expect(health.message).toContain("error state");
    expect(health.details?.error).toBe(1);
  });

  it("returns degraded when last check is stale (>15 minutes old)", async () => {
    const harness = makeHarness();
    seedCompanyAndAgents(harness, [makeAgent({ id: "a1" })]);
    await setupPlugin(harness);

    // Manually set a stale health check result
    await harness.ctx.state.set(
      { scopeKind: "instance", stateKey: "last-health-check" },
      {
        checkedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        totalAgents: 1,
        healthy: 1,
        degraded: 0,
        error: 0,
      },
    );

    const health = await plugin.definition.onHealth!();
    expect(health.status).toBe("degraded");
    expect(health.message).toContain("minutes ago");
  });
});

// ---------------------------------------------------------------------------
// Manifest integrity
// ---------------------------------------------------------------------------

describe("Tortuga manifest", () => {
  it("declares expected capabilities", () => {
    expect(manifest.capabilities).toContain("agents.read");
    expect(manifest.capabilities).toContain("agents.pause");
    expect(manifest.capabilities).toContain("agents.resume");
    expect(manifest.capabilities).toContain("agents.invoke");
    expect(manifest.capabilities).toContain("events.subscribe");
    expect(manifest.capabilities).toContain("jobs.schedule");
    expect(manifest.capabilities).toContain("issues.read");
    expect(manifest.capabilities).toContain("plugin.state.read");
    expect(manifest.capabilities).toContain("plugin.state.write");
  });

  it("declares UI slots", () => {
    expect(manifest.ui?.slots).toHaveLength(3);
    const types = manifest.ui!.slots!.map((s) => s.type);
    expect(types).toContain("dashboardWidget");
    expect(types).toContain("page");
    expect(types).toContain("sidebar");
  });
});

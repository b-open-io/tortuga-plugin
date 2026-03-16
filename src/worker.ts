import {
  definePlugin,
  runWorker,
  type PaperclipPlugin,
  type PluginContext,
  type PluginEvent,
  type PluginJobContext,
  type PluginHealthDiagnostics,
  type Agent,
} from "@paperclipai/plugin-sdk";
import { JOB_KEYS, STREAM_CHANNELS } from "./constants.js";

// ---------------------------------------------------------------------------
// State key constants (scoped to this worker, not exported to UI)
// ---------------------------------------------------------------------------

const STATE_KEYS = {
  /** Per-agent health snapshot: status, lastHeartbeat, run counts */
  agentHealth: "health",
  /** Per-agent last-run timestamp */
  lastRun: "last-run",
  /** Per-agent run counters: started, completed, failed */
  runCounts: "run-counts",
  /** Instance-level: last fleet health check timestamp */
  lastHealthCheck: "last-health-check",
} as const;

const DATA_KEYS = {
  fleetOverview: "fleet-overview",
  agentDetail: "agent-detail",
} as const;

const ACTION_KEYS = {
  pauseAgent: "pause-agent",
  resumeAgent: "resume-agent",
  invokeAgent: "invoke-agent",
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentHealthState = {
  status: Agent["status"];
  lastHeartbeatAt: string | null;
  lastCheckedAt: string;
  runCounts: RunCounts;
  lastRunAt: string | null;
};

type RunCounts = {
  started: number;
  completed: number;
  failed: number;
};

type FleetHealthCheckResult = {
  checkedAt: string;
  totalAgents: number;
  healthy: number;
  degraded: number;
  error: number;
};

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let currentContext: PluginContext | null = null;
const openStreams = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function requireParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

/**
 * Classify an agent's health based on its status and heartbeat recency.
 * Returns "healthy", "degraded", or "error".
 */
function classifyHealth(agent: Agent): "healthy" | "degraded" | "error" {
  const terminalStatuses: Agent["status"][] = ["terminated", "error"];
  if (terminalStatuses.includes(agent.status)) return "error";

  if (agent.status === "paused" || agent.status === "pending_approval") {
    return "degraded";
  }

  // Check heartbeat recency — degraded if no heartbeat in 15 minutes
  if (agent.lastHeartbeatAt) {
    const age = Date.now() - new Date(agent.lastHeartbeatAt).getTime();
    const fifteenMinutes = 15 * 60 * 1000;
    if (age > fifteenMinutes) return "degraded";
  }

  return "healthy";
}

async function getRunCounts(ctx: PluginContext, agentId: string): Promise<RunCounts> {
  const counts = await ctx.state.get({
    scopeKind: "agent",
    scopeId: agentId,
    stateKey: STATE_KEYS.runCounts,
  });
  return (counts as RunCounts) ?? { started: 0, completed: 0, failed: 0 };
}

async function setRunCounts(ctx: PluginContext, agentId: string, counts: RunCounts): Promise<void> {
  await ctx.state.set(
    { scopeKind: "agent", scopeId: agentId, stateKey: STATE_KEYS.runCounts },
    counts,
  );
}

async function getAgentHealthState(ctx: PluginContext, agentId: string): Promise<AgentHealthState | null> {
  const state = await ctx.state.get({
    scopeKind: "agent",
    scopeId: agentId,
    stateKey: STATE_KEYS.agentHealth,
  });
  return (state as AgentHealthState) ?? null;
}

async function setAgentHealthState(ctx: PluginContext, agentId: string, state: AgentHealthState): Promise<void> {
  await ctx.state.set(
    { scopeKind: "agent", scopeId: agentId, stateKey: STATE_KEYS.agentHealth },
    state,
  );
}

// ---------------------------------------------------------------------------
// Fleet health check logic
// ---------------------------------------------------------------------------

async function performFleetHealthCheck(ctx: PluginContext): Promise<FleetHealthCheckResult> {
  // List all companies, then all agents per company
  const companies = await ctx.companies.list({ limit: 100 });
  const allAgents: Agent[] = [];

  for (const company of companies) {
    const agents = await ctx.agents.list({ companyId: company.id, limit: 200, offset: 0 });
    allAgents.push(...agents);
  }

  let healthy = 0;
  let degraded = 0;
  let errorCount = 0;
  const changedAgents: Array<{ agent: Agent; previousStatus: string | null; health: string }> = [];

  for (const agent of allAgents) {
    const health = classifyHealth(agent);
    const runCounts = await getRunCounts(ctx, agent.id);
    const previousState = await getAgentHealthState(ctx, agent.id);

    const newState: AgentHealthState = {
      status: agent.status,
      lastHeartbeatAt: agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).toISOString() : null,
      lastCheckedAt: new Date().toISOString(),
      runCounts,
      lastRunAt: previousState?.lastRunAt ?? null,
    };

    // Detect status changes since last check
    if (previousState && previousState.status !== agent.status) {
      changedAgents.push({
        agent,
        previousStatus: previousState.status,
        health,
      });
    }

    await setAgentHealthState(ctx, agent.id, newState);

    switch (health) {
      case "healthy": healthy++; break;
      case "degraded": degraded++; break;
      case "error": errorCount++; break;
    }
  }

  const result: FleetHealthCheckResult = {
    checkedAt: new Date().toISOString(),
    totalAgents: allAgents.length,
    healthy,
    degraded,
    error: errorCount,
  };

  // Persist last health check timestamp
  await ctx.state.set(
    { scopeKind: "instance", stateKey: STATE_KEYS.lastHealthCheck },
    result,
  );

  // Stream status changes to UI
  if (changedAgents.length > 0) {
    for (const { agent, previousStatus, health } of changedAgents) {
      ctx.streams.emit(STREAM_CHANNELS.fleetStatus, {
        type: "health-check-change",
        agentId: agent.id,
        agentName: agent.name,
        companyId: agent.companyId,
        previousStatus,
        currentStatus: agent.status,
        health,
        checkedAt: result.checkedAt,
      });
    }
  }

  // Always emit a summary event so the UI knows a check completed
  ctx.streams.emit(STREAM_CHANNELS.fleetStatus, {
    type: "health-check-complete",
    ...result,
  });

  return result;
}

// ---------------------------------------------------------------------------
// Registration: Jobs
// ---------------------------------------------------------------------------

function registerJobHandlers(ctx: PluginContext): void {
  ctx.jobs.register(JOB_KEYS.fleetHealth, async (job: PluginJobContext) => {
    ctx.logger.info("Starting fleet health check", {
      runId: job.runId,
      trigger: job.trigger,
    });

    try {
      const result = await performFleetHealthCheck(ctx);
      ctx.logger.info("Fleet health check completed", {
        runId: job.runId,
        totalAgents: result.totalAgents,
        healthy: result.healthy,
        degraded: result.degraded,
        error: result.error,
      });
    } catch (error) {
      ctx.logger.error("Fleet health check failed", {
        runId: job.runId,
        error: summarizeError(error),
      });
      throw error;
    }
  });
}

// ---------------------------------------------------------------------------
// Registration: Events
// ---------------------------------------------------------------------------

function registerEventHandlers(ctx: PluginContext): void {
  // Agent status changed — update state, push to stream
  ctx.events.on("agent.status_changed", async (event: PluginEvent) => {
    const agentId = event.entityId;
    if (!agentId) return;

    const payload = event.payload as Record<string, unknown>;
    ctx.logger.info("Agent status changed", { agentId, payload });

    // Update persisted health state
    const runCounts = await getRunCounts(ctx, agentId);
    const previousState = await getAgentHealthState(ctx, agentId);

    const newStatus = (payload.newStatus ?? payload.status ?? previousState?.status ?? "idle") as Agent["status"];

    await setAgentHealthState(ctx, agentId, {
      status: newStatus,
      lastHeartbeatAt: previousState?.lastHeartbeatAt ?? null,
      lastCheckedAt: new Date().toISOString(),
      runCounts,
      lastRunAt: previousState?.lastRunAt ?? null,
    });

    // Push live update to UI
    ctx.streams.emit(STREAM_CHANNELS.fleetStatus, {
      type: "agent-status-changed",
      agentId,
      companyId: event.companyId,
      previousStatus: previousState?.status ?? null,
      newStatus,
      occurredAt: event.occurredAt,
    });
  });

  // Agent run started — track active run
  ctx.events.on("agent.run.started", async (event: PluginEvent) => {
    const agentId = event.entityId;
    if (!agentId) return;

    const payload = event.payload as Record<string, unknown>;
    ctx.logger.info("Agent run started", { agentId, runId: payload.runId });

    const counts = await getRunCounts(ctx, agentId);
    counts.started++;
    await setRunCounts(ctx, agentId, counts);

    // Update lastRunAt
    const healthState = await getAgentHealthState(ctx, agentId);
    if (healthState) {
      healthState.lastRunAt = event.occurredAt;
      healthState.runCounts = counts;
      await setAgentHealthState(ctx, agentId, healthState);
    }

    ctx.streams.emit(STREAM_CHANNELS.fleetStatus, {
      type: "run-started",
      agentId,
      companyId: event.companyId,
      runId: payload.runId,
      occurredAt: event.occurredAt,
    });
  });

  // Agent run finished — track completion
  ctx.events.on("agent.run.finished", async (event: PluginEvent) => {
    const agentId = event.entityId;
    if (!agentId) return;

    const payload = event.payload as Record<string, unknown>;
    ctx.logger.info("Agent run finished", { agentId, runId: payload.runId });

    const counts = await getRunCounts(ctx, agentId);
    counts.completed++;
    await setRunCounts(ctx, agentId, counts);

    const healthState = await getAgentHealthState(ctx, agentId);
    if (healthState) {
      healthState.lastRunAt = event.occurredAt;
      healthState.runCounts = counts;
      await setAgentHealthState(ctx, agentId, healthState);
    }

    ctx.streams.emit(STREAM_CHANNELS.fleetStatus, {
      type: "run-finished",
      agentId,
      companyId: event.companyId,
      runId: payload.runId,
      occurredAt: event.occurredAt,
    });
  });

  // Agent run failed — track failure, alert
  ctx.events.on("agent.run.failed", async (event: PluginEvent) => {
    const agentId = event.entityId;
    if (!agentId) return;

    const payload = event.payload as Record<string, unknown>;
    ctx.logger.warn("Agent run failed", {
      agentId,
      runId: payload.runId,
      error: payload.error,
    });

    const counts = await getRunCounts(ctx, agentId);
    counts.failed++;
    await setRunCounts(ctx, agentId, counts);

    const healthState = await getAgentHealthState(ctx, agentId);
    if (healthState) {
      healthState.lastRunAt = event.occurredAt;
      healthState.runCounts = counts;
      await setAgentHealthState(ctx, agentId, healthState);
    }

    ctx.streams.emit(STREAM_CHANNELS.fleetStatus, {
      type: "run-failed",
      agentId,
      companyId: event.companyId,
      runId: payload.runId,
      error: payload.error ?? null,
      occurredAt: event.occurredAt,
    });
  });
}

// ---------------------------------------------------------------------------
// Registration: Data handlers (for UI via usePluginData)
// ---------------------------------------------------------------------------

function registerDataHandlers(ctx: PluginContext): void {
  // Fleet overview — all agents with status, heartbeat, run counts
  ctx.data.register(DATA_KEYS.fleetOverview, async (params) => {
    const companyId = requireParam(params, "companyId");

    const agents = await ctx.agents.list({ companyId, limit: 200, offset: 0 });

    const fleet = await Promise.all(
      agents.map(async (agent) => {
        const healthState = await getAgentHealthState(ctx, agent.id);
        const health = classifyHealth(agent);

        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          title: agent.title,
          icon: agent.icon,
          status: agent.status,
          health,
          lastHeartbeatAt: agent.lastHeartbeatAt
            ? new Date(agent.lastHeartbeatAt).toISOString()
            : null,
          budgetMonthlyCents: agent.budgetMonthlyCents,
          spentMonthlyCents: agent.spentMonthlyCents,
          runCounts: healthState?.runCounts ?? { started: 0, completed: 0, failed: 0 },
          lastRunAt: healthState?.lastRunAt ?? null,
        };
      }),
    );

    // Compute summary counts
    let healthy = 0;
    let degraded = 0;
    let errorCount = 0;
    for (const entry of fleet) {
      switch (entry.health) {
        case "healthy": healthy++; break;
        case "degraded": degraded++; break;
        case "error": errorCount++; break;
      }
    }

    // Get last health check result
    const lastCheck = await ctx.state.get({
      scopeKind: "instance",
      stateKey: STATE_KEYS.lastHealthCheck,
    }) as FleetHealthCheckResult | null;

    return {
      totalAgents: agents.length,
      healthy,
      degraded,
      error: errorCount,
      lastHealthCheckAt: lastCheck?.checkedAt ?? null,
      fleet,
    };
  });

  // Single agent detail with recent run history from state
  ctx.data.register(DATA_KEYS.agentDetail, async (params) => {
    const agentId = requireParam(params, "agentId");
    const companyId = requireParam(params, "companyId");

    const agent = await ctx.agents.get(agentId, companyId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const healthState = await getAgentHealthState(ctx, agentId);
    const health = classifyHealth(agent);

    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      icon: agent.icon,
      status: agent.status,
      health,
      reportsTo: agent.reportsTo,
      capabilities: agent.capabilities,
      adapterType: agent.adapterType,
      budgetMonthlyCents: agent.budgetMonthlyCents,
      spentMonthlyCents: agent.spentMonthlyCents,
      lastHeartbeatAt: agent.lastHeartbeatAt
        ? new Date(agent.lastHeartbeatAt).toISOString()
        : null,
      runCounts: healthState?.runCounts ?? { started: 0, completed: 0, failed: 0 },
      lastRunAt: healthState?.lastRunAt ?? null,
      lastCheckedAt: healthState?.lastCheckedAt ?? null,
      createdAt: agent.createdAt ? new Date(agent.createdAt).toISOString() : null,
      updatedAt: agent.updatedAt ? new Date(agent.updatedAt).toISOString() : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Registration: Actions (for UI via usePluginAction)
// ---------------------------------------------------------------------------

function registerActionHandlers(ctx: PluginContext): void {
  // Pause an agent
  ctx.actions.register(ACTION_KEYS.pauseAgent, async (params) => {
    const agentId = requireParam(params, "agentId");
    const companyId = requireParam(params, "companyId");

    ctx.logger.info("Pausing agent", { agentId, companyId });

    const agent = await ctx.agents.pause(agentId, companyId);
    return {
      ok: true,
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
    };
  });

  // Resume a paused agent
  ctx.actions.register(ACTION_KEYS.resumeAgent, async (params) => {
    const agentId = requireParam(params, "agentId");
    const companyId = requireParam(params, "companyId");

    ctx.logger.info("Resuming agent", { agentId, companyId });

    const agent = await ctx.agents.resume(agentId, companyId);
    return {
      ok: true,
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
    };
  });

  // Invoke an agent with a prompt
  ctx.actions.register(ACTION_KEYS.invokeAgent, async (params) => {
    const agentId = requireParam(params, "agentId");
    const companyId = requireParam(params, "companyId");
    const prompt = requireParam(params, "prompt");
    const reason = typeof params.reason === "string" ? params.reason : undefined;

    ctx.logger.info("Invoking agent", { agentId, companyId, reason });

    const { runId } = await ctx.agents.invoke(agentId, companyId, { prompt, reason });
    return {
      ok: true,
      agentId,
      runId,
    };
  });
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin: PaperclipPlugin = definePlugin({
  async setup(ctx: PluginContext) {
    currentContext = ctx;
    ctx.logger.info("Tortuga plugin starting setup");

    // All registrations are synchronous within setup
    registerJobHandlers(ctx);
    registerEventHandlers(ctx);
    registerDataHandlers(ctx);
    registerActionHandlers(ctx);

    ctx.logger.info("Tortuga plugin setup complete");
  },

  async onHealth(): Promise<PluginHealthDiagnostics> {
    const ctx = currentContext;
    if (!ctx) {
      return { status: "error", message: "Plugin context not initialized" };
    }

    try {
      const lastCheck = await ctx.state.get({
        scopeKind: "instance",
        stateKey: STATE_KEYS.lastHealthCheck,
      }) as FleetHealthCheckResult | null;

      if (!lastCheck) {
        return {
          status: "degraded",
          message: "No fleet health check has been performed yet",
          details: { lastCheck: null },
        };
      }

      // Degraded if last check was more than 15 minutes ago (job runs every 5m)
      const checkAge = Date.now() - new Date(lastCheck.checkedAt).getTime();
      const fifteenMinutes = 15 * 60 * 1000;

      if (checkAge > fifteenMinutes) {
        return {
          status: "degraded",
          message: `Last fleet health check was ${Math.round(checkAge / 60000)} minutes ago`,
          details: {
            lastCheckAt: lastCheck.checkedAt,
            totalAgents: lastCheck.totalAgents,
            healthy: lastCheck.healthy,
            degraded: lastCheck.degraded,
            error: lastCheck.error,
            checkAgeMs: checkAge,
          },
        };
      }

      // Error if any agents are in error state
      if (lastCheck.error > 0) {
        return {
          status: "degraded",
          message: `${lastCheck.error} agent(s) in error state. ${lastCheck.healthy}/${lastCheck.totalAgents} healthy.`,
          details: {
            lastCheckAt: lastCheck.checkedAt,
            totalAgents: lastCheck.totalAgents,
            healthy: lastCheck.healthy,
            degraded: lastCheck.degraded,
            error: lastCheck.error,
          },
        };
      }

      return {
        status: "ok",
        message: `Fleet healthy. ${lastCheck.healthy}/${lastCheck.totalAgents} agents OK.`,
        details: {
          lastCheckAt: lastCheck.checkedAt,
          totalAgents: lastCheck.totalAgents,
          healthy: lastCheck.healthy,
          degraded: lastCheck.degraded,
          error: lastCheck.error,
        },
      };
    } catch (error) {
      return {
        status: "error",
        message: `Health check failed: ${summarizeError(error)}`,
      };
    }
  },

  async onShutdown() {
    if (currentContext) {
      for (const channel of openStreams) {
        try {
          currentContext.streams.close(channel);
        } catch {
          // Best-effort cleanup
        }
      }
      openStreams.clear();
    }

    currentContext = null;
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

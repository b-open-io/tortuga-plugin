import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  usePluginAction,
  usePluginData,
  usePluginStream,
  usePluginToast,
} from "@paperclipai/plugin-sdk/ui";
import type {
  PluginPageProps,
  PluginSidebarProps,
  PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";

// ---------------------------------------------------------------------------
// Stream safety — isolate usePluginStream behind an error boundary so that
// a 501 (stream bus not wired up) or any other SSE failure does not crash
// the entire plugin component. Data from usePluginData remains the primary
// source; stream data is a live overlay when available.
// ---------------------------------------------------------------------------

type SafeStreamData<T> = { events: T[]; connected: boolean };

const EMPTY_STREAM_DATA: SafeStreamData<never> = { events: [], connected: false };

/**
 * Error boundary that silently swallows stream-related render errors.
 * When the wrapped child (which calls usePluginStream) throws, this
 * boundary catches the error and renders nothing — the parent component
 * continues to function using usePluginData results.
 */
class StreamErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn("[tortuga] stream error caught, degrading gracefully:", error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

/**
 * Thin component that calls usePluginStream and reports results to the
 * parent via a stable callback. Rendered inside StreamErrorBoundary so
 * that any error from the hook is caught without crashing the parent.
 */
function FleetStreamConnector({
  companyId,
  onUpdate,
}: {
  companyId: string | undefined;
  onUpdate: (data: SafeStreamData<FleetStatusEvent>) => void;
}) {
  const stream = usePluginStream<FleetStatusEvent>("tortuga:fleet-status", {
    companyId,
  });

  useEffect(() => {
    onUpdate({ events: stream.events, connected: stream.connected });
  }, [stream.events, stream.connected, onUpdate]);

  return null;
}

/**
 * Hook that provides fleet stream data safely. Returns a stable empty
 * result until the stream connector reports data, and degrades to the
 * empty result if the stream connector crashes.
 */
function useSafeFleetStream(companyId: string | null | undefined): {
  streamData: SafeStreamData<FleetStatusEvent>;
  StreamConnectorElement: ReactNode;
} {
  const [streamData, setStreamData] = useState<SafeStreamData<FleetStatusEvent>>(
    EMPTY_STREAM_DATA as SafeStreamData<FleetStatusEvent>,
  );

  const handleUpdate = useCallback((data: SafeStreamData<FleetStatusEvent>) => {
    setStreamData(data);
  }, []);

  const effectiveCompanyId = companyId ?? undefined;

  const element = (
    <StreamErrorBoundary>
      <FleetStreamConnector companyId={effectiveCompanyId} onUpdate={handleUpdate} />
    </StreamErrorBoundary>
  );

  return { streamData, StreamConnectorElement: element };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Agent status values matching `Agent["status"]` from `@paperclipai/plugin-sdk`.
 *
 * The SDK `Agent` type is not re-exported on the `@paperclipai/plugin-sdk/ui`
 * subpath, so we replicate the union here. Keep in sync with:
 *   `@paperclipai/shared` -> `AGENT_STATUSES`
 */
type AgentStatus =
  | "active"
  | "paused"
  | "idle"
  | "running"
  | "error"
  | "pending_approval"
  | "terminated";

/**
 * UI projection of the SDK `Agent` type, shaped by the worker's `fleet-overview`
 * data handler. Field names and types mirror their `Agent` counterparts where
 * applicable. Fields not present on `Agent` (e.g. `health`, `runCounts`) are
 * plugin-computed additions.
 */
type FleetAgent = {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  icon: string | null;
  status: AgentStatus;
  health: "healthy" | "degraded" | "error";
  lastHeartbeatAt: string | null;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  runCounts: { started: number; completed: number; failed: number };
  lastRunAt: string | null;
};

type FleetOverview = {
  totalAgents: number;
  healthy: number;
  degraded: number;
  error: number;
  lastHealthCheckAt: string | null;
  fleet: FleetAgent[];
};

/**
 * Agent detail response from the worker's `agent-detail` data handler.
 *
 * Fields mirror the SDK `Agent` type, plus plugin-computed health and run data.
 * This is returned as a flat object (not nested under `agent`).
 */
type AgentDetailData = {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  icon: string | null;
  status: AgentStatus;
  health: "healthy" | "degraded" | "error";
  reportsTo: string | null;
  capabilities: string | null;
  adapterType: string;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  lastHeartbeatAt: string | null;
  runCounts: { started: number; completed: number; failed: number };
  lastRunAt: string | null;
  lastCheckedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type FleetStatusEvent = {
  type: string;
  agentId: string;
  companyId: string;
  previousStatus: AgentStatus | null;
  newStatus?: AgentStatus;
  currentStatus?: AgentStatus;
  health?: string;
  occurredAt: string;
};

// ---------------------------------------------------------------------------
// Shared inline styles (following ClawNet kitchen-sink pattern)
// ---------------------------------------------------------------------------

const PAGE_ROUTE = "tortuga";

const layoutStack: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "12px",
  padding: "14px",
  background: "var(--card, transparent)",
};

const subtleCardStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, var(--border) 75%, transparent)",
  borderRadius: "10px",
  padding: "12px",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "8px",
};

const buttonStyle: CSSProperties = {
  appearance: "none",
  border: "1px solid var(--border)",
  borderRadius: "999px",
  background: "transparent",
  color: "inherit",
  padding: "6px 12px",
  fontSize: "12px",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "var(--foreground)",
  color: "var(--background)",
  borderColor: "var(--foreground)",
};

const dangerButtonStyle: CSSProperties = {
  ...buttonStyle,
  color: "var(--destructive, #dc2626)",
  borderColor: "color-mix(in srgb, var(--destructive, #dc2626) 50%, var(--border))",
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "8px 10px",
  background: "transparent",
  color: "inherit",
  fontSize: "12px",
};

const mutedTextStyle: CSSProperties = {
  fontSize: "12px",
  opacity: 0.72,
  lineHeight: 1.45,
};

const eyebrowStyle: CSSProperties = {
  fontSize: "11px",
  opacity: 0.65,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  marginBottom: "10px",
};

const statValueStyle: CSSProperties = {
  fontSize: "24px",
  fontWeight: 700,
  lineHeight: 1,
};

const statLabelStyle: CSSProperties = {
  fontSize: "11px",
  opacity: 0.6,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginTop: "4px",
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function hostPath(companyPrefix: string | null | undefined, suffix: string): string {
  return companyPrefix ? `/${companyPrefix}${suffix}` : suffix;
}

function pluginPagePath(companyPrefix: string | null | undefined): string {
  return hostPath(companyPrefix, `/${PAGE_ROUTE}`);
}

function relativeTime(isoString: string | null): string {
  if (!isoString) return "never";
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Small shared primitives
// ---------------------------------------------------------------------------

function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        borderRadius: "999px",
        border: "1px solid var(--border)",
        padding: "2px 8px",
        fontSize: "11px",
        background: color
          ? `color-mix(in srgb, ${color} 14%, transparent)`
          : undefined,
        borderColor: color
          ? `color-mix(in srgb, ${color} 40%, var(--border))`
          : undefined,
      }}
    >
      {label}
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "#16a34a",
  running: "#2563eb",
  idle: "#d97706",
  error: "#dc2626",
  paused: "#6b7280",
  pending_approval: "#d97706",
  terminated: "#dc2626",
  online: "#16a34a",
};

function StatusDot({ status }: { status: string }) {
  const dotColor = STATUS_COLORS[status.toLowerCase()] ?? "#6b7280";
  return (
    <span
      style={{
        display: "inline-block",
        width: "7px",
        height: "7px",
        borderRadius: "50%",
        background: dotColor,
        flexShrink: 0,
      }}
      aria-label={status}
    />
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        fontSize: "13px",
        opacity: 0.55,
      }}
    >
      {message}
    </div>
  );
}

function LoadingIndicator({ message }: { message?: string }) {
  return (
    <div
      style={{
        padding: "24px 16px",
        textAlign: "center",
        fontSize: "12px",
        opacity: 0.6,
      }}
    >
      {message ?? "Loading..."}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        ...subtleCardStyle,
        borderColor: "color-mix(in srgb, #dc2626 45%, var(--border))",
        fontSize: "12px",
        color: "var(--destructive, #dc2626)",
      }}
    >
      {message}
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={cardStyle}>
      <div style={sectionHeaderStyle}>
        <strong>{title}</strong>
        {action}
      </div>
      <div style={layoutStack}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fleet-specific helpers
// ---------------------------------------------------------------------------

function statusCounts(agents: FleetAgent[]): Record<AgentStatus, number> {
  const counts: Record<AgentStatus, number> = {
    active: 0,
    paused: 0,
    idle: 0,
    running: 0,
    error: 0,
    pending_approval: 0,
    terminated: 0,
  };
  for (const agent of agents) {
    if (agent.status in counts) {
      counts[agent.status]++;
    }
  }
  return counts;
}

function StatusBreakdown({ agents }: { agents: FleetAgent[] }) {
  const counts = statusCounts(agents);
  const entries: { status: AgentStatus; label: string }[] = [
    { status: "active", label: "Active" },
    { status: "running", label: "Running" },
    { status: "idle", label: "Idle" },
    { status: "error", label: "Error" },
    { status: "paused", label: "Paused" },
    { status: "pending_approval", label: "Pending" },
    { status: "terminated", label: "Terminated" },
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
      {entries.map(({ status, label }) => (
        <div
          key={status}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "12px",
          }}
        >
          <StatusDot status={status} />
          <span style={{ opacity: 0.8 }}>
            {counts[status]} {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anchor icon (fleet/ship-wheel inspired)
// ---------------------------------------------------------------------------

function FleetIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {/* Helm / ship wheel */}
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 6v-3" />
      <path d="M12 21v-3" />
      <path d="M6 12H3" />
      <path d="M21 12h-3" />
      <path d="M7.76 7.76L5.64 5.64" />
      <path d="M18.36 18.36l-2.12-2.12" />
      <path d="M16.24 7.76l2.12-2.12" />
      <path d="M5.64 18.36l2.12-2.12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 1. FleetStatusWidget
// ---------------------------------------------------------------------------

/**
 * Compact dashboard widget showing fleet health at a glance.
 *
 * Displays total agent count, status breakdown (running/idle/error/paused),
 * last health check timestamp, and a live indicator when streaming.
 */
export function FleetStatusWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId;

  const overviewParams = useMemo(
    () => (companyId ? { companyId } : {}),
    [companyId],
  );
  const { data: overview, loading, error } = usePluginData<FleetOverview>(
    "fleet-overview",
    overviewParams,
  );

  const { streamData: fleetStream, StreamConnectorElement } = useSafeFleetStream(companyId);

  // Apply live status updates on top of fetched data
  const agents = useMemo(() => {
    const base = overview?.fleet ?? [];
    if (fleetStream.events.length === 0) return base;

    // Build latest status map from stream events
    const latestStatus = new Map<string, AgentStatus>();
    for (const event of fleetStream.events) {
      const status = event.newStatus ?? event.currentStatus;
      if (status) {
        latestStatus.set(event.agentId, status);
      }
    }

    return base.map((agent) => {
      const liveStatus = latestStatus.get(agent.id);
      return liveStatus ? { ...agent, status: liveStatus } : agent;
    });
  }, [overview?.fleet, fleetStream.events]);

  if (loading) return <LoadingIndicator message="Loading fleet status..." />;
  if (error) return <ErrorBanner message={error.message} />;

  const totalAgents = agents.length;

  return (
    <div style={layoutStack}>
      {StreamConnectorElement}
      <div style={rowStyle}>
        <strong>Fleet Status</strong>
        {fleetStream.connected ? <StatusDot status="online" /> : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
        }}
      >
        <div>
          <div style={statValueStyle}>{totalAgents}</div>
          <div style={statLabelStyle}>Agents</div>
        </div>
        <div>
          <div style={statValueStyle}>
            {statusCounts(agents).running}
          </div>
          <div style={statLabelStyle}>Running</div>
        </div>
      </div>

      <StatusBreakdown agents={agents} />

      <div style={{ ...mutedTextStyle, fontSize: "11px" }}>
        Last health check: {relativeTime(overview?.lastHealthCheckAt ?? null)}
      </div>

      <a
        href={pluginPagePath(context.companyPrefix)}
        style={{ fontSize: "12px", color: "inherit" }}
      >
        Open fleet monitor
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. FleetMonitorPage
// ---------------------------------------------------------------------------

type StatusFilter = "all" | AgentStatus;
type AgentDetailView = { agentId: string } | null;

function StatusFilterBar({
  active,
  onChange,
  counts,
}: {
  active: StatusFilter;
  onChange: (filter: StatusFilter) => void;
  counts: Record<AgentStatus, number>;
}) {
  const filters: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "running", label: "Running" },
    { key: "idle", label: "Idle" },
    { key: "error", label: "Error" },
    { key: "paused", label: "Paused" },
  ];

  return (
    <div style={{ display: "flex", gap: "0", borderBottom: "1px solid var(--border)" }}>
      {filters.map((filter) => {
        const count = filter.key === "all"
          ? Object.values(counts).reduce((a, b) => a + b, 0)
          : counts[filter.key];
        return (
          <button
            key={filter.key}
            type="button"
            onClick={() => onChange(filter.key)}
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              borderBottom:
                active === filter.key
                  ? "2px solid var(--foreground)"
                  : "2px solid transparent",
              color:
                active === filter.key
                  ? "var(--foreground)"
                  : "var(--muted-foreground, inherit)",
              padding: "10px 16px",
              fontSize: "13px",
              fontWeight: active === filter.key ? 600 : 400,
              cursor: "pointer",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {filter.label}
            <span style={{ marginLeft: "6px", fontSize: "11px", opacity: 0.6 }}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AgentRow({
  agent,
  onSelect,
  onPause,
  onResume,
  actionLoading,
}: {
  agent: FleetAgent;
  onSelect: () => void;
  onPause: () => void;
  onResume: () => void;
  actionLoading: boolean;
}) {
  return (
    <div
      style={{
        ...subtleCardStyle,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "10px",
        alignItems: "center",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Left: agent info */}
      <div style={{ display: "grid", gap: "6px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <StatusDot status={agent.status} />
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.name}
          </span>
          {agent.role ? <Pill label={agent.role} /> : null}
          {agent.title ? <Pill label={agent.title} color="#6366f1" /> : null}
        </div>
        <div style={mutedTextStyle}>
          Last heartbeat: {relativeTime(agent.lastHeartbeatAt)}
          {agent.lastRunAt ? ` \u00b7 Last run: ${relativeTime(agent.lastRunAt)}` : ""}
        </div>
      </div>

      {/* Right: action buttons */}
      <div
        style={{ display: "flex", gap: "6px", flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {agent.status === "active" || agent.status === "running" || agent.status === "idle" ? (
          <button
            type="button"
            style={buttonStyle}
            onClick={onPause}
            disabled={actionLoading}
            title="Pause agent"
          >
            Pause
          </button>
        ) : null}
        {agent.status === "paused" ? (
          <button
            type="button"
            style={buttonStyle}
            onClick={onResume}
            disabled={actionLoading}
            title="Resume agent"
          >
            Resume
          </button>
        ) : null}
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={onSelect}
          disabled={actionLoading || agent.status === "paused" || agent.status === "terminated"}
          title="Invoke agent (opens detail panel)"
        >
          Invoke
        </button>
      </div>
    </div>
  );
}

function AgentDetailPanel({
  agentId,
  companyId,
  onBack,
  onPause,
  onResume,
  onInvoke,
}: {
  agentId: string;
  companyId: string;
  onBack: () => void;
  onPause: (agentId: string) => void;
  onResume: (agentId: string) => void;
  onInvoke: (agentId: string, prompt: string) => void;
}) {
  const detailParams = useMemo(
    () => ({ companyId, agentId }),
    [companyId, agentId],
  );
  const { data: detail, loading, error } = usePluginData<AgentDetailData>(
    "agent-detail",
    detailParams,
  );

  const [invokePrompt, setInvokePrompt] = useState("");

  if (loading) return <LoadingIndicator message="Loading agent details..." />;
  if (error) return <ErrorBanner message={error.message} />;
  if (!detail) return <EmptyState message="Agent not found." />;

  return (
    <div style={layoutStack}>
      {/* Back + header */}
      <div style={rowStyle}>
        <button type="button" style={buttonStyle} onClick={onBack}>
          Back
        </button>
        <StatusDot status={detail.status} />
        <strong style={{ fontSize: "16px" }}>{detail.name}</strong>
        <Pill label={detail.status} color={STATUS_COLORS[detail.status]} />
      </div>

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "12px",
        }}
      >
        <div style={subtleCardStyle}>
          <div style={eyebrowStyle}>Role</div>
          <div style={{ fontSize: "13px", marginTop: "4px" }}>
            {detail.role ?? "Not assigned"}
          </div>
        </div>
        <div style={subtleCardStyle}>
          <div style={eyebrowStyle}>Adapter</div>
          <div style={{ fontSize: "13px", marginTop: "4px" }}>
            {detail.adapterType ?? "Default"}
          </div>
        </div>
        <div style={subtleCardStyle}>
          <div style={eyebrowStyle}>Last Heartbeat</div>
          <div style={{ fontSize: "13px", marginTop: "4px" }}>
            {relativeTime(detail.lastHeartbeatAt)}
          </div>
        </div>
        <div style={subtleCardStyle}>
          <div style={eyebrowStyle}>Last Run</div>
          <div style={{ fontSize: "13px", marginTop: "4px" }}>
            {relativeTime(detail.lastRunAt)}
          </div>
        </div>
      </div>

      {/* Run counts + budget */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
          gap: "12px",
        }}
      >
        <div style={subtleCardStyle}>
          <div style={statValueStyle}>{detail.runCounts.started}</div>
          <div style={statLabelStyle}>Started</div>
        </div>
        <div style={subtleCardStyle}>
          <div style={statValueStyle}>{detail.runCounts.completed}</div>
          <div style={statLabelStyle}>Completed</div>
        </div>
        <div style={subtleCardStyle}>
          <div style={statValueStyle}>{detail.runCounts.failed}</div>
          <div style={statLabelStyle}>Failed</div>
        </div>
        <div style={subtleCardStyle}>
          <div style={statValueStyle}>${(detail.spentMonthlyCents / 100).toFixed(2)}</div>
          <div style={statLabelStyle}>Spent</div>
        </div>
        <div style={subtleCardStyle}>
          <div style={statValueStyle}>${(detail.budgetMonthlyCents / 100).toFixed(2)}</div>
          <div style={statLabelStyle}>Budget</div>
        </div>
      </div>

      {/* Actions */}
      <div style={rowStyle}>
        {detail.status === "active" || detail.status === "running" || detail.status === "idle" ? (
          <button
            type="button"
            style={dangerButtonStyle}
            onClick={() => onPause(detail.id)}
          >
            Pause Agent
          </button>
        ) : null}
        {detail.status === "paused" ? (
          <button
            type="button"
            style={buttonStyle}
            onClick={() => onResume(detail.id)}
          >
            Resume Agent
          </button>
        ) : null}
      </div>

      {/* Invoke prompt */}
      <Section title="Invoke Agent">
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            value={invokePrompt}
            onChange={(e) => setInvokePrompt(e.target.value)}
            placeholder="Enter prompt to invoke agent..."
            style={{ ...inputStyle, flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && invokePrompt.trim()) {
                onInvoke(detail.id, invokePrompt.trim());
                setInvokePrompt("");
              }
            }}
          />
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => {
              if (invokePrompt.trim()) {
                onInvoke(detail.id, invokePrompt.trim());
                setInvokePrompt("");
              }
            }}
            disabled={!invokePrompt.trim() || detail.status === "paused" || detail.status === "terminated"}
          >
            Send
          </button>
        </div>
      </Section>
    </div>
  );
}

/**
 * Full fleet monitoring page.
 *
 * Shows an agent grid with status filter, per-agent pause/resume/invoke
 * actions, a live stream indicator, and agent detail panel on click.
 */
export function FleetMonitorPage({ context }: PluginPageProps) {
  const companyId = context.companyId;
  const toast = usePluginToast();

  // Fleet data
  const overviewParams = useMemo(
    () => (companyId ? { companyId } : {}),
    [companyId],
  );
  const {
    data: overview,
    loading,
    error,
    refresh,
  } = usePluginData<FleetOverview>("fleet-overview", overviewParams);

  // Stream (isolated behind error boundary — degrades gracefully on 501)
  const { streamData: fleetStream, StreamConnectorElement } = useSafeFleetStream(companyId);

  // Actions
  const pauseAgent = usePluginAction("pause-agent");
  const resumeAgent = usePluginAction("resume-agent");
  const invokeAgent = usePluginAction("invoke-agent");

  // UI state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [detailView, setDetailView] = useState<AgentDetailView>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Apply live status updates
  const agents = useMemo(() => {
    const base = overview?.fleet ?? [];
    if (fleetStream.events.length === 0) return base;

    const latestStatus = new Map<string, AgentStatus>();
    for (const event of fleetStream.events) {
      const status = event.newStatus ?? event.currentStatus;
      if (status) {
        latestStatus.set(event.agentId, status);
      }
    }

    return base.map((agent) => {
      const liveStatus = latestStatus.get(agent.id);
      return liveStatus ? { ...agent, status: liveStatus } : agent;
    });
  }, [overview?.fleet, fleetStream.events]);

  // Filter
  const filteredAgents = useMemo(() => {
    if (statusFilter === "all") return agents;
    return agents.filter((a) => a.status === statusFilter);
  }, [agents, statusFilter]);

  const counts = useMemo(() => statusCounts(agents), [agents]);

  // Action handlers
  async function handlePause(agentId: string) {
    if (!companyId || actionLoading) return;
    setActionLoading(true);
    try {
      await pauseAgent({ companyId, agentId });
      refresh();
      toast({
        title: "Agent paused",
        body: "The agent has been paused and will not execute until resumed.",
        tone: "success",
      });
    } catch (err) {
      toast({
        title: "Failed to pause agent",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleResume(agentId: string) {
    if (!companyId || actionLoading) return;
    setActionLoading(true);
    try {
      await resumeAgent({ companyId, agentId });
      refresh();
      toast({
        title: "Agent resumed",
        body: "The agent is now active and ready to process work.",
        tone: "success",
      });
    } catch (err) {
      toast({
        title: "Failed to resume agent",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleInvoke(agentId: string, prompt?: string) {
    if (!companyId || actionLoading) return;
    setActionLoading(true);
    try {
      await invokeAgent({ companyId, agentId, prompt: prompt ?? undefined });
      refresh();
      toast({
        title: "Agent invoked",
        body: prompt
          ? `Agent invoked with prompt: "${prompt}"`
          : "Agent has been invoked.",
        tone: "success",
      });
    } catch (err) {
      toast({
        title: "Failed to invoke agent",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    } finally {
      setActionLoading(false);
    }
  }

  // Detail view
  if (detailView && companyId) {
    return (
      <div style={{ ...layoutStack, maxWidth: "800px" }}>
        <AgentDetailPanel
          agentId={detailView.agentId}
          companyId={companyId}
          onBack={() => setDetailView(null)}
          onPause={(id) => void handlePause(id)}
          onResume={(id) => void handleResume(id)}
          onInvoke={(id, prompt) => void handleInvoke(id, prompt)}
        />
      </div>
    );
  }

  // No company selected
  if (!companyId) {
    return (
      <div style={layoutStack}>
        <Section title="Fleet Monitor">
          <EmptyState message="Select a company to view your agent fleet." />
        </Section>
      </div>
    );
  }

  return (
    <div style={layoutStack}>
      {StreamConnectorElement}
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
            Fleet Monitor
          </h1>
          <div style={mutedTextStyle}>
            {overview
              ? `${overview.totalAgents} agent${overview.totalAgents === 1 ? "" : "s"} registered. Last health check: ${relativeTime(overview.lastHealthCheckAt)}`
              : "Loading fleet data..."}
          </div>
        </div>
        <div style={rowStyle}>
          {fleetStream.connected ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "11px",
                opacity: 0.7,
              }}
            >
              <StatusDot status="online" />
              Live
            </div>
          ) : null}
          <button
            type="button"
            style={buttonStyle}
            onClick={() => refresh()}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <StatusFilterBar
        active={statusFilter}
        onChange={setStatusFilter}
        counts={counts}
      />

      {/* Agent list */}
      {loading && agents.length === 0 ? (
        <LoadingIndicator message="Loading fleet agents..." />
      ) : error ? (
        <ErrorBanner message={error.message} />
      ) : filteredAgents.length === 0 ? (
        <EmptyState
          message={
            statusFilter !== "all"
              ? `No agents with status "${statusFilter}".`
              : "No agents registered in this fleet."
          }
        />
      ) : (
        <div style={{ display: "grid", gap: "8px" }}>
          {filteredAgents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              onSelect={() => setDetailView({ agentId: agent.id })}
              onPause={() => void handlePause(agent.id)}
              onResume={() => void handleResume(agent.id)}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. TortugaSidebarLink
// ---------------------------------------------------------------------------

/**
 * Sidebar navigation link to the fleet monitor page.
 * Shows a helm icon and an agent count badge from fleet overview.
 */
export function TortugaSidebarLink({ context }: PluginSidebarProps) {
  const overviewParams = useMemo(
    () => (context.companyId ? { companyId: context.companyId } : {}),
    [context.companyId],
  );
  const { data: overview } = usePluginData<FleetOverview>(
    "fleet-overview",
    overviewParams,
  );

  const href = pluginPagePath(context.companyPrefix);
  const isActive =
    typeof window !== "undefined" && window.location.pathname === href;

  const agentCount = overview?.totalAgents ?? 0;

  return (
    <a
      href={href}
      aria-current={isActive ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 12px",
        fontSize: "13px",
        fontWeight: isActive ? 600 : 400,
        textDecoration: "none",
        color: isActive
          ? "var(--foreground)"
          : "color-mix(in srgb, var(--foreground) 80%, transparent)",
        background: isActive
          ? "color-mix(in srgb, var(--accent, var(--muted)) 60%, transparent)"
          : "transparent",
        borderRadius: "6px",
        transition: "background 0.15s, color 0.15s",
        cursor: "pointer",
      }}
    >
      <FleetIcon size={16} />

      <span style={{ flex: 1 }}>Tortuga</span>

      {/* Agent count badge */}
      {agentCount > 0 ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: "20px",
            height: "18px",
            borderRadius: "999px",
            background:
              "color-mix(in srgb, var(--foreground) 12%, transparent)",
            fontSize: "10px",
            fontWeight: 600,
            padding: "0 5px",
            flexShrink: 0,
          }}
        >
          {agentCount}
        </span>
      ) : null}
    </a>
  );
}

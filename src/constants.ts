export const PLUGIN_ID = "bopen-io.tortuga-plugin";
declare const __PLUGIN_VERSION__: string;
export const PLUGIN_VERSION = __PLUGIN_VERSION__;
export const PAGE_ROUTE = "tortuga";

export const SLOT_IDS = {
  dashboardWidget: "tortuga-dashboard-widget",
  page: "tortuga-page",
  sidebar: "tortuga-sidebar-link",
} as const;

export const EXPORT_NAMES = {
  dashboardWidget: "FleetStatusWidget",
  page: "FleetMonitorPage",
  sidebar: "TortugaSidebarLink",
} as const;

export const JOB_KEYS = {
  fleetHealth: "fleet-health",
} as const;

export const STREAM_CHANNELS = {
  fleetStatus: "tortuga:fleet-status",
} as const;

export const DATA_KEYS = {
  fleetOverview: "fleet-overview",
  agentDetail: "agent-detail",
} as const;

export const ACTION_KEYS = {
  pauseAgent: "pause-agent",
  resumeAgent: "resume-agent",
  invokeAgent: "invoke-agent",
} as const;

export const STATE_KEYS = {
  /** Per-agent health snapshot: status, lastHeartbeat, run counts */
  agentHealth: "health",
  /** Instance-level: last fleet health check timestamp */
  lastHealthCheck: "last-health-check",
  /** Per-agent run counters: started, completed, failed */
  runCounts: "run-counts",
} as const;

export const PLUGIN_ID = "bopen-io.tortuga-plugin";
export const PLUGIN_VERSION = "0.0.3";
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
  fleetStatus: "fleet-status",
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
  agentHealth: "agent-health",
  lastHealthCheck: "last-health-check",
  runCount: "run-count",
  lastRunAt: "last-run-at",
  failureCount: "failure-count",
} as const;

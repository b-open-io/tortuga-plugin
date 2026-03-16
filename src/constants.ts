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

import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import {
  EXPORT_NAMES,
  JOB_KEYS,
  PAGE_ROUTE,
  PLUGIN_ID,
  PLUGIN_VERSION,
  SLOT_IDS,
} from "./constants.js";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Tortuga",
  description:
    "bOpen fleet monitoring and operations: real-time agent health, heartbeat tracking, cost analytics",
  author: "bOpen",
  categories: ["ui", "automation"],
  capabilities: [
    // Fleet monitoring & control
    "agents.read",
    "agents.pause",
    "agents.resume",
    "agents.invoke",
    // Plugin state for fleet data
    "plugin.state.read",
    "plugin.state.write",
    // Agent lifecycle events
    "events.subscribe",
    // Scheduled fleet health check
    "jobs.schedule",
    // UI surfaces
    "ui.dashboardWidget.register",
    "ui.page.register",
    "ui.sidebar.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  jobs: [
    {
      jobKey: JOB_KEYS.fleetHealth,
      displayName: "Fleet Health Check",
      description:
        "Cross-references Paperclip agents with fleet state to detect unhealthy or missing agents.",
      schedule: "*/5 * * * *",
    },
  ],
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: SLOT_IDS.dashboardWidget,
        displayName: "Fleet Status",
        exportName: EXPORT_NAMES.dashboardWidget,
      },
      {
        type: "page",
        id: SLOT_IDS.page,
        displayName: "Fleet Monitor",
        exportName: EXPORT_NAMES.page,
        routePath: PAGE_ROUTE,
      },
      {
        type: "sidebar",
        id: SLOT_IDS.sidebar,
        displayName: "Tortuga",
        exportName: EXPORT_NAMES.sidebar,
      },
    ],
  },
};

export default manifest;

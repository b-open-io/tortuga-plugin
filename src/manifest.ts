import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "bopen-io.tortuga-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Tortuga",
  description: "bOpen agent fleet bridge: syncs agents from ClawNet registry, exposes skills as tools, fleet monitoring, webhook integrations",
  author: "bOpen",
  categories: ["connector"],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write",
    "ui.dashboardWidget.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "health-widget",
        displayName: "Tortuga Health",
        exportName: "DashboardWidget"
      }
    ]
  }
};

export default manifest;

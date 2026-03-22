# Changelog

## 0.0.11

### Added
- Routine issue tracking: fleet health check indexes routine-execution issues per agent
- Execution issue indicators in fleet monitor agent rows
- Execution issues section in agent detail panel
- `agent-routines` data handler for routine execution issue data
- Heartbeat wakeup integration: `invokeAgent` persists wakeup metadata and emits stream event
- `issues.read` capability for execution issue queries
- `lastWakeupRequest` in agent detail data

### Changed
- `agent.run.finished`/`agent.run.failed` stream events include `invocationSource` and `triggerDetail`
- Fleet overview includes `hasExecutionIssues` flag per agent

## 0.0.8

### Fixed

- Fix FleetOverview type to match worker response (fleet, totalAgents, lastHealthCheckAt fields)

## 0.0.7

### Fixed

- Fix "undefined agents registered" — UI was reading `overview.total` instead of `overview.totalAgents`

## 0.0.6

### Fixed

- Import STATE_KEYS/DATA_KEYS/ACTION_KEYS from constants (was redefined locally with wrong values)
- Namespace stream channel to tortuga:fleet-status (prevents collision with ClawNet plugin)
- Add per-agent serialization lock for run count updates (race condition fix)
- Add prompt length validation (10k max) on invoke-agent action
- Remove dead openStreams tracking code
- Build constants.js separately for bundle:false manifest

### Added

- Fleet monitoring worker: health check job, event handlers, data/action handlers
- Fleet UI: FleetStatusWidget, FleetMonitorPage, TortugaSidebarLink
- 43 tests covering all handlers and lifecycle
- Architecture document with full plugin design

## 0.0.1

### Added

- Initial scaffold

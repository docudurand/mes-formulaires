---
stepsCompleted:
  - step-01-create-epic-list
  - step-02-design-epic-list
  - step-03-create-stories
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
---
# github - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for github, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Administrator can access monitoring UI via a secured internal route.
FR2: System can restrict access to authorized users.
FR3: System can prevent public access to the monitor.
FR4: System can capture and centralize application logs (info/warn/error).
FR5: System can maintain an in-memory buffer of recent logs.
FR6: System can associate a level with each log entry.
FR7: System can stream logs in real time to the client.
FR8: System can establish and maintain a streaming connection.
FR9: System can deliver new logs without page reload.
FR10: Administrator can view live logs on a dedicated page.
FR11: System can display a global status (OK/ERROR) in real time.
FR12: UI can visually emphasize error state.
FR13: Administrator can filter logs by level (info/warn/error).
FR14: Administrator can filter logs by keyword. (post-MVP)
FR15: Administrator can pause the log stream. (post-MVP)
FR16: Administrator can view recent logs stored in memory.
FR17: Administrator can export logs as JSON. (post-MVP)
FR18: System can trigger alerts when thresholds are reached. (post-MVP)
FR19: Administrator can configure alert thresholds. (post-MVP)
FR20: System can send external notifications (mail/webhook). (post-MVP)
FR21: System can expose a /health endpoint for global status.
FR22: Administrator can view health status from the monitor.

### NonFunctional Requirements

NFR1: Each log appears in the monitor within < 1 second of emission.
NFR2: SSE remains stable for 1 primary client, with occasional 2-3 concurrent connections.
NFR3: Monitor access is restricted (internal, non-public route).
NFR4: Access is protected by a simple mechanism (token or basic auth) at MVP.
NFR5: IP allowlist is not required at MVP.
NFR6: Partial log loss is acceptable under overload.
NFR7: No persistence guarantee (memory buffer only).
NFR8: Buffer retains max 500 logs or 5 minutes, FIFO eviction.
NFR9: Readable contrast, clear visuals, explicit status indicators.

### Additional Requirements

- Starter template: none (reuse existing Express codebase)
- Monitoring module in monitor/ with routes /monitor, /monitor/stream, /monitor/health
- Auth via Bearer token header, secret in MONITOR_TOKEN env var
- SSE payload: { ts, level, message, context }, event 'log' and 'error'
- Buffer FIFO memory-only (500 logs / 5 min), no persistence
- UI static in public/monitor.html, public/monitor.js, public/monitor.css
- Env vars: MONITOR_ENABLED, MONITOR_TOKEN

### FR Coverage Map

- Epic 1: FR1, FR2, FR3, FR10
- Epic 2: FR4, FR5, FR6, FR7, FR8, FR9, FR16
- Epic 3: FR11, FR12, FR21, FR22
- Epic 4: FR13, FR14, FR15, FR17, FR18, FR19, FR20

## Epic List

1. Secure Monitor Access & Routing (MVP)
2. Real-time Logging Pipeline & Buffer (MVP)
3. Monitor UI & Health Status (MVP)
4. Post-MVP Enhancements: Filters, Export, Alerts

## Epic 1: Secure Monitor Access & Routing (MVP)

Goal: Restrict monitor access to authorized internal users and expose the monitor routes in a dedicated module.

### Story 1.1: Guard monitor routes with a bearer token

As an administrator,
I want monitor routes protected by a bearer token,
So that only authorized users can access the monitor.

**Acceptance Criteria:**

**Given** MONITOR_ENABLED is true
**When** a request is made without a valid Authorization header
**Then** the server responds with 401 and does not serve monitor content.

**Given** MONITOR_ENABLED is true
**When** a request is made with Authorization: Bearer <MONITOR_TOKEN>
**Then** the server allows access to the requested monitor route.

### Story 1.2: Serve the monitor UI on a dedicated route

As an administrator,
I want a dedicated /monitor page,
So that I can view logs from a single internal URL.

**Acceptance Criteria:**

**Given** MONITOR_ENABLED is true and the request is authorized
**When** I request GET /monitor
**Then** the server returns the monitor HTML page.

**Given** the monitor HTML references monitor.css and monitor.js
**When** the browser requests those assets
**Then** the static files are served successfully.

### Story 1.3: Mount monitoring routes from a dedicated module

As a developer,
I want the monitoring routes separated in a monitor module,
So that server.js only mounts the monitor router.

**Acceptance Criteria:**

**Given** the monitor module is present under monitor/
**When** server.js starts
**Then** it mounts /monitor, /monitor/stream, and /monitor/health from that module.

**Given** the global health endpoint exists
**When** GET /healthz is called
**Then** it remains distinct from /monitor/health.

## Epic 2: Real-time Logging Pipeline & Buffer (MVP)

Goal: Capture application logs, keep a FIFO buffer, and stream new entries to clients via SSE.

### Story 2.1: Centralize logs with levels and context

As a developer,
I want a central logger that records level and context,
So that logs are standardized and ready for streaming.

**Acceptance Criteria:**

**Given** a log entry is emitted with level, message, and optional context
**When** the logger handles it
**Then** it stores a log object { ts, level, message, context }.

**Given** the logger receives info, warn, or error
**When** the entry is processed
**Then** the level is preserved and can be filtered later.

### Story 2.2: Maintain an in-memory FIFO buffer

As a developer,
I want logs stored in a bounded in-memory buffer,
So that recent logs are available without persistence.

**Acceptance Criteria:**

**Given** the buffer size reaches 500 logs or 5 minutes of retention
**When** a new log entry arrives
**Then** the oldest entries are evicted first (FIFO).

**Given** server load is high
**When** logs are dropped due to buffer pressure
**Then** the system continues operating without crashing.

### Story 2.3: Stream new logs via SSE

As an administrator,
I want logs streamed in real time,
So that I can see issues immediately without reloading.

**Acceptance Criteria:**

**Given** a client connects to GET /monitor/stream with a valid token
**When** a new log is emitted
**Then** the server sends an SSE event "log" containing JSON { ts, level, message, context } within 1 second.

**Given** the SSE connection is open
**When** multiple clients connect (1 primary, up to 2-3 total)
**Then** each client receives the stream without interrupting others.

**Given** an unexpected stream error occurs
**When** the server detects the error
**Then** it sends an SSE event "error" and closes the connection.

## Epic 3: Monitor UI & Health Status (MVP)

Goal: Provide a readable monitor page with live updates and clear error signaling, plus a dedicated health endpoint.

### Story 3.1: Display live logs without reload

As an administrator,
I want the monitor page to append logs as they arrive,
So that I can watch activity in real time.

**Acceptance Criteria:**

**Given** the monitor page is open
**When** new SSE log events arrive
**Then** new rows are appended to the log list without a full page reload.

**Given** the log list grows beyond the visible limit
**When** new entries are appended
**Then** older entries are trimmed from the DOM to match the buffer size.

### Story 3.2: Expose monitor health state

As an administrator,
I want a /monitor/health endpoint,
So that I can check monitor status independently of /healthz.

**Acceptance Criteria:**

**Given** the monitor is enabled
**When** GET /monitor/health is called with a valid token
**Then** it returns JSON { status: "ok" | "error", lastErrorAt }.

**Given** an error log is recorded
**When** the next health check occurs
**Then** status returns "error" with a timestamp for the last error.

### Story 3.3: Show status badge and error emphasis

As an administrator,
I want a clear OK/ERROR indicator,
So that I can see problems immediately.

**Acceptance Criteria:**

**Given** the page loads
**When** the health endpoint returns status "ok"
**Then** the UI shows a green OK badge.

**Given** an error log is received or health returns "error"
**When** the UI updates
**Then** it shows a red blinking ERROR badge.

## Epic 4: Post-MVP Enhancements: Filters, Export, Alerts

Goal: Add filtering, pause, export, and alerting capabilities after the MVP is stable.

### Story 4.1: Filter logs by level

As an administrator,
I want to filter the log list by level,
So that I can focus on errors or warnings.

**Acceptance Criteria:**

**Given** multiple log levels are present
**When** I select a level filter
**Then** only logs matching the selected level are shown.

### Story 4.2: Keyword search and pause

As an administrator,
I want to search and pause the stream,
So that I can inspect logs without losing context.

**Acceptance Criteria:**

**Given** the log list is visible
**When** I enter a keyword
**Then** only matching logs are displayed.

**Given** the stream is active
**When** I click Pause
**Then** the UI stops appending new logs until I resume.

### Story 4.3: Export recent logs

As an administrator,
I want to export logs as JSON,
So that I can archive or share them.

**Acceptance Criteria:**

**Given** logs are buffered in memory
**When** I trigger export
**Then** the system downloads a JSON file of the recent logs.

### Story 4.4: Configure and trigger alerts

As an administrator,
I want threshold-based alerts and notifications,
So that I am warned of errors without watching the screen.

**Acceptance Criteria:**

**Given** alert thresholds are configured
**When** error counts exceed the threshold
**Then** an alert is triggered.

**Given** an alert is triggered
**When** notification delivery is configured
**Then** an email or webhook is sent.

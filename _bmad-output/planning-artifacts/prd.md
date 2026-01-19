---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
inputDocuments:
  - docs/index.md
  - docs/project-overview.md
  - docs/architecture.md
  - docs/api-contracts.md
  - docs/data-models.md
  - docs/source-tree-analysis.md
  - docs/component-inventory.md
  - docs/development-guide.md
  - docs/deployment-guide.md
workflowType: 'prd'
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 9
  projectContext: 0
classification:
  projectType: web_app
  domain: supervision et maintenance applicative interne
  complexity: low-medium
  projectContext: brownfield
---

# Product Requirements Document - github

**Author:** Damien
**Date:** 2026-01-19T10:23:14.614Z

## Executive Summary

Internal monitoring screen for the existing Node.js/Express service on Render. Goal: view application logs in real time, detect errors immediately with a clear visual alert, and reduce diagnostic time without using the Render UI. Single internal admin user, MPA with a single /monitor page, no SEO, no external API dependencies.

## Success Criteria

### User Success
- Logs displayed in real time with < 1s latency.
- Errors visible immediately via red, blinking badge.
- Level filters (info/warn/error) available and working.
- Page remains readable without reload.

### Business Success
- MTTR reduced from minutes to seconds.
- Errors detected before user reports.
- Fewer context switches to Render logs.

### Technical Success
- Low, controlled performance impact.
- No dependency on Render API.
- Logs kept in memory with a bounded buffer.
- Access restricted (internal tool only).
- Availability aligned with Render service uptime.

### Measurable Outcomes
- < 1s log display latency end-to-end.
- Visual error indicator triggers immediately on error emission.
- Filters toggle instantly without reload.
- MTTR reduced to seconds for common incidents.
- Diagnosis possible without opening Render UI.

## Product Scope

### MVP - Minimum Viable Product
- Central logger (info/warn/error).
- Real-time stream (SSE).
- /monitor page with live display.
- OK / ERROR status badge.
- /health endpoint.

### Growth Features (Post-MVP)
- Advanced filters (text search, pause).
- Exportable history (JSON).
- Configurable alert thresholds.
- External notifications (mail/webhook).

### Vision (Future)
- Unified internal monitoring dashboard.
- Persistent log history.
- Multi-service Render monitoring.
- Multi-channel automated alerts.

## User Journeys

### 1) Administrateur - Primary path (surveillance continue)
Damien opens /monitor at the start of the day and keeps it open. Logs stream in real time (< 1s). He watches the status badge and occasionally filters to warn for early signals. The page remains usable without reload while he works.
**Climax:** an anomaly appears; he sees it immediately and reacts without opening Render UI.
**Resolution:** fast diagnosis and action.

### 2) Administrateur - Edge case (crash / error flood)
A server crash triggers an error spike. The badge turns red and blinks. Damien focuses on the most recent logs and uses the in-memory buffer to find the trigger.
**Climax:** the root cause appears in the latest lines; he fixes it quickly.
**Resolution:** service stabilizes and monitoring returns to OK.

### 3) Admin/Ops - Control and configuration
Damien uses /monitor to check global health via /health and keeps a stable observation routine. He filters by level to review event categories and prepares to adjust alert thresholds (post-MVP).
**Climax:** a repeatable monitoring routine is established.
**Resolution:** stable supervision with reduced cognitive load.

### 4) Support/Investigation - After-the-fact analysis
After an incident, Damien reviews the memory buffer, filters by keyword or level, and reconstructs the timeline. If needed, he exports logs (post-MVP).
**Climax:** the failure sequence is isolated.
**Resolution:** clearer post-mortem and corrective action.

### 5) API/Integration
No external integrations planned.

### Journey Requirements Summary
- Real-time UI (/monitor) with SSE and status badge.
- Level filters + text search (post-MVP).
- Memory buffer for recent logs.
- Clear error indication (badge + blinking).
- /health endpoint for global status.
- Export logs (post-MVP).

## Web App Specific Requirements

### Project-Type Overview
Internal lightweight MPA centered on a single /monitor page. No SPA framework. Real-time stream for logs and status. No SEO.

### Technical Architecture Considerations
- MPA with a single /monitor page.
- Real-time via SSE for logs + status only.
- Modern browsers only (Chrome/Edge/Firefox).

### Browser & UX Requirements
- No legacy support.
- Basic accessibility: readable contrast and explicit status indicators.

### Performance & Realtime
- Streaming logs without page refresh.
- No other real-time features.

### Implementation Considerations
- Internal-only, non-indexed UI.
- Minimal navigation.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy
**MVP Approach:** Problem-solving MVP (validate internal monitoring).
**Resource Requirements:** Solo dev (full-stack).

### MVP Feature Set (Phase 1)
**Core User Journeys Supported:**
- Continuous monitoring
- Incident handling (edge case)

**Must-Have Capabilities:**
- Central logger (info / warn / error)
- Real-time stream (SSE)
- /monitor live display
- OK / ERROR badge
- /health endpoint

### Post-MVP Features
**Phase 2 (Post-MVP):**
- Advanced filters (text search, pause)
- Exportable history (JSON)
- Configurable alert thresholds
- External notifications (mail / webhook)

**Phase 3 (Expansion):**
- Unified monitoring dashboard
- Persistent log history
- Multi-service Render monitoring
- Multi-channel automated alerts

### Risk Mitigation Strategy
**Technical Risks:** performance and memory (bounded buffer + controlled emit rate).
**Market Risks:** low (internal tool).
**Resource Risks:** solo dev -> strict MVP scope.

## Functional Requirements

### Access & Security
- FR1: Administrator can access monitoring UI via a secured internal route.
- FR2: System can restrict access to authorized users.
- FR3: System can prevent public access to the monitor.

### Log Collection & Normalization
- FR4: System can capture and centralize application logs (info/warn/error).
- FR5: System can maintain an in-memory buffer of recent logs.
- FR6: System can associate a level with each log entry.

### Real-Time Streaming (SSE)
- FR7: System can stream logs in real time to the client.
- FR8: System can establish and maintain a streaming connection.
- FR9: System can deliver new logs without page reload.

### Visualization & Status
- FR10: Administrator can view live logs on a dedicated page.
- FR11: System can display a global status (OK/ERROR) in real time.
- FR12: UI can visually emphasize error state.

### Filtering & Search
- FR13: Administrator can filter logs by level (info/warn/error).
- FR14: Administrator can filter logs by keyword. (post-MVP)
- FR15: Administrator can pause the log stream. (post-MVP)

### Export & History
- FR16: Administrator can view recent logs stored in memory.
- FR17: Administrator can export logs as JSON. (post-MVP)

### Notifications & Alerting
- FR18: System can trigger alerts when thresholds are reached. (post-MVP)
- FR19: Administrator can configure alert thresholds. (post-MVP)
- FR20: System can send external notifications (mail/webhook). (post-MVP)

### Health & Diagnostics
- FR21: System can expose a /health endpoint for global status.
- FR22: Administrator can view health status from the monitor.

## Non-Functional Requirements

### Performance
- NFR1: Each log appears in the monitor within < 1 second of emission.
- NFR2: SSE remains stable for 1 primary client, with occasional 2-3 concurrent connections.

### Security
- NFR3: Monitor access is restricted (internal, non-public route).
- NFR4: Access is protected by a simple mechanism (token or basic auth) at MVP.
- NFR5: IP allowlist is not required at MVP.

### Reliability / Data Loss
- NFR6: Partial log loss is acceptable under overload.
- NFR7: No persistence guarantee (memory buffer only).

### Data Retention (Memory Buffer)
- NFR8: Buffer retains max 500 logs or 5 minutes, FIFO eviction.

### Accessibility (Basic)
- NFR9: Readable contrast, clear visuals, explicit status indicators.

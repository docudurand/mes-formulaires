---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - docs/index.md
  - docs/project-overview.md
  - docs/architecture.md
  - docs/api-contracts.md
  - docs/data-models.md
  - docs/source-tree-analysis.md
  - docs/component-inventory.md
  - docs/development-guide.md
  - docs/deployment-guide.md
workflowType: 'architecture'
project_name: 'github'
user_name: 'Damien'
date: '2026-01-19T11:32:19.363Z'
lastStep: 8
status: 'complete'
completedAt: '2026-01-19T12:00:14.029037Z'
---







# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._


## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
Le systeme doit capturer/centraliser les logs (info/warn/error), conserver un buffer memoire, diffuser en temps reel via SSE vers une page /monitor, et afficher un etat global OK/ERREUR. Les capacites post-MVP ajoutent recherche, pause, export JSON, seuils d'alerte et notifications externes.

**Non-Functional Requirements:**
Latence d'affichage < 1s, SSE stable pour 1 client (2-3 occasionnels), acces restreint (route interne + token/auth basique), tolerance a perte partielle de logs, buffer memoire 500 logs ou 5 minutes, accessibilite basique.

**Scale & Complexity:**
- Primary domain: web_app / internal monitoring
- Complexity level: low-medium
- Estimated architectural components: 3-5 (logger/buffer, SSE stream, UI monitor, auth gate, health)

### Technical Constraints & Dependencies
- Aucune dependance Render API.
- Stockage en memoire uniquement (buffer FIFO).
- Route interne protegee (token/auth basique).
- MPA simple /monitor, navigateurs modernes.

### Cross-Cutting Concerns Identified
- Securite d'acces (auth gate).
- Performance & memoire (buffer borne + emission controlee).
- Fiabilite du flux SSE.
- Observabilite interne (moniteur + statut).


## Starter Template Evaluation

### Primary Technology Domain
Existing Node.js/Express monolith (MPA) with a single /monitor page.

### Starter Options Considered
- No new starter template. The project already has a working Express service and will extend it.

### Selected Starter: None (reuse existing Express codebase)

**Rationale for Selection:**
- Existing monolith already hosts routes, middleware, and deployment config.
- Scope is a focused internal feature (/monitor + SSE) that fits the current structure.
- Avoids overhead and migration risk of introducing a new starter.

**Initialization Command:**
```bash
# No new project initialization; extend current codebase.
```

**Architectural Decisions Provided by Starter:**
None. We keep current Express conventions, routing structure, and deployment on Render/Docker.


## Core Architectural Decisions

### Decision Priority Analysis
**Critical Decisions (Block Implementation):**
- Auth par token (Authorization: Bearer) + secret en env var MONITOR_TOKEN.
- SSE sur route dediee /monitor/stream.
- Buffer logs en memoire FIFO (pas de persistance).

**Important Decisions (Shape Architecture):**
- Payload log JSON { ts, level, message, context }.
- Event SSE error + statut HTTP cote API.

**Deferred Decisions (Post-MVP):**
- Persistance historique (post-MVP).
- Notifications externes (post-MVP).

### Data Architecture
- Decision: Buffer memoire FIFO uniquement (no disk persistence).
- Rationale: MVP rapide, faible overhead, tolerance a perte partielle.
- Affects: logger + stream + UI.

### Authentication & Security
- Decision: Bearer token sur header Authorization.
- Secret: env var MONITOR_TOKEN.
- Rationale: simple et suffisant pour un outil interne.

### API & Communication Patterns
- Decision: SSE via /monitor/stream.
- Payload: { ts, level, message, context }.
- Error handling: event SSE error + HTTP status adapte cote API.

### Frontend Architecture
- Decision: UI HTML/CSS/JS (sans framework).
- Update model: append DOM + trimming du buffer affiche.

### Infrastructure & Deployment
- Decision: Render + Dockerfile existant.
- Env vars: MONITOR_ENABLED, MONITOR_TOKEN.

### Decision Impact Analysis
**Implementation Sequence:**
1) Auth gate + env vars
2) Buffer FIFO + logger central
3) SSE /monitor/stream
4) UI /monitor + DOM updates
5) Error event handling + status badge

**Cross-Component Dependencies:**
- Auth gate protege /monitor et /monitor/stream.
- Buffer alimente SSE et UI.
- Payload standard utilise par stream + UI.


## Implementation Patterns & Consistency Rules

### Pattern Categories Defined
**Critical Conflict Points Identified:** naming, structure, formats, process.

### Naming Patterns
**API Naming Conventions:**
- Endpoints en kebab-case: /monitor, /monitor/stream, /monitor/health.
- Headers: Authorization: Bearer <token>.

**Data Naming Conventions:**
- JSON en camelCase: ts, level, message, context.
- Levels standardises: info|warn|error.

### Structure Patterns
**Project Organization:**
- Module dedie monitor/ (server + public).
- Routes centralisees dans server.js (ou routes/monitor.js si refactor).
- UI statique dans public/monitor.html, public/monitor.js, public/monitor.css.

### Format Patterns
**SSE Format:**
- event: log (default) et error pour anomalies.
- payload unique: { ts, level, message, context }.
- ts au format ISO 8601.

### Process Patterns
**Buffer & Stream:**
- Buffer FIFO unique (500 logs / 5 min).
- Throttle d'emission SSE si surcharge (drop oldest).

### Enforcement Guidelines
**All AI Agents MUST:**
- Respecter les conventions d'endpoint et payload.
- Utiliser le buffer FIFO unique et la meme politique d'eviction.
- Garder l'UI en HTML/JS statique sans framework.

**Pattern Enforcement:**
- Verifier les conventions lors de chaque MR.
- Documenter toute exception dans l'architecture.md.

### Pattern Examples
**Good Examples:**
- GET /monitor/stream -> SSE: event: log, data: { ts, level, message, context }
- Authorization: Bearer <token>

**Anti-Patterns:**
- JSON en snake_case
- Multiples formats de payload
- WebSocket introduit sans decision explicite


## Project Structure & Boundaries

### Complete Project Directory Structure
```
project-root/
  server.js
  monitor/
    monitor.js             # buffer, logger, SSE core
    auth.js                # token auth helper
    routes.js              # /monitor, /monitor/stream, /monitor/health
  public/
    monitor.html
    monitor.js
    monitor.css
  routes/
    ... (existing)
```

### Architectural Boundaries

**API Boundaries:**
- /monitor (UI)
- /monitor/stream (SSE)
- /monitor/health (monitor status)
- /healthz (global health)

**Component Boundaries:**
- monitor/* contains all monitoring logic.
- server.js only mounts the monitor module.

**Service Boundaries:**
- No external services for monitoring (memory-only).

**Data Boundaries:**
- FIFO buffer in monitor/monitor.js; no persistence.

### Requirements to Structure Mapping

**Feature Mapping:**
- Access & Security -> monitor/auth.js, monitor/routes.js
- Log collection & buffer -> monitor/monitor.js
- SSE streaming -> monitor/monitor.js + monitor/routes.js
- UI monitor -> public/monitor.html, public/monitor.js, public/monitor.css
- Health -> /monitor/health in monitor/routes.js

**Cross-Cutting Concerns:**
- Auth gate protects /monitor and /monitor/stream.
- Shared payload shape used by stream and UI.

### Integration Points

**Internal Communication:**
- server.js mounts monitor/routes.js
- monitor/routes.js calls monitor/monitor.js APIs

**External Integrations:**
- None for monitoring

**Data Flow:**
- app logs -> monitor/monitor.js buffer -> SSE -> public/monitor.js

### File Organization Patterns

**Configuration Files:**
- Env vars MONITOR_ENABLED, MONITOR_TOKEN

**Source Organization:**
- monitor/* for monitoring logic, public/* for UI assets

**Test Organization:**
- No tests defined yet (to be added later)

**Asset Organization:**
- UI assets in public/

### Development Workflow Integration

**Development Server Structure:**
- server.js remains entry point, monitor mounted under /monitor

**Build Process Structure:**
- No new build step; static assets served from public/

**Deployment Structure:**
- Render/Docker unchanged


## Architecture Validation Results

### Coherence Validation
**Decision Compatibility:** decisions coherentes (Express existant, SSE, buffer FIFO, auth token).
**Pattern Consistency:** naming + structure alignes avec payload SSE et UI statique.
**Structure Alignment:** structure monitor/ + public/ supporte les choix techniques.

### Requirements Coverage Validation
**Functional Requirements Coverage:** tous les FRs sont couverts (monitor UI, SSE, auth, buffer, health).
**Non-Functional Requirements Coverage:** latence, securite, buffer, accessibilite traites.

### Implementation Readiness Validation
**Decision Completeness:** decisions critiques documentees.
**Structure Completeness:** arborescence claire, frontieres definies.
**Pattern Completeness:** conventions nommage + format + process fixees.

### Gap Analysis Results
- Critical: aucun.
- Important: aucun.
- Nice-to-have: tests automatises (post-MVP).

### Architecture Readiness Assessment
**Overall Status:** READY FOR IMPLEMENTATION
**Confidence Level:** high
**Key Strengths:** scope clair, simple, sans dependances externes.
**Areas for Future Enhancement:** tests, persistance, alerting externe.

### Implementation Handoff
**AI Agent Guidelines:**
- Respecter toutes les decisions d'architecture documentees.
- Appliquer les patterns de nommage/format/structure sans divergence.
- Utiliser la structure monitor/ + public/ telle que definie.

**First Implementation Priority:**
- Mettre en place monitor/ (buffer FIFO + SSE) puis UI /monitor.


## Architecture Completion Summary

### Workflow Completion
**Architecture Decision Workflow:** COMPLETED
**Total Steps Completed:** 8
**Date Completed:** 2026-01-19T12:00:14.029037Z
**Document Location:** _bmad-output/planning-artifacts/architecture.md

### Final Architecture Deliverables

**Complete Architecture Document**
- Architectural decisions, patterns, structure, and validation recorded
- Requirements mapped to files and boundaries

**Implementation Ready Foundation**
- Consistent patterns for AI agents
- Clear project structure and integration points

### Implementation Handoff
**For AI Agents:** Follow decisions, patterns, and structure exactly as documented.

**First Implementation Priority:**
- Implement monitor/ (buffer FIFO + SSE), then UI /monitor.

### Architecture Status
**READY FOR IMPLEMENTATION**


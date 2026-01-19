---
project_name: 'github'
user_name: 'Damien'
date: '2026-01-19T11:59:48.492680Z'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 37
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- Runtime: Node.js >= 20 (ESM, type: module)
- Framework: Express ^4.19.2
- HTTP client: axios ^1.11.0
- SMTP: nodemailer ^7.0.5
- Uploads: multer ^2.0.2
- FTP: basic-ftp ^5.0.5
- PDF: pdfkit ^0.17.1, pdf-lib ^1.17.1
- QR: qrcode ^1.5.4
- Excel: exceljs ^4.4.0
- Deploy: Render + Docker (node:20-alpine)

## Critical Implementation Rules

### Language-Specific Rules
- ESM only (type: module), no require.
- Explicit imports with extensions when needed (./file.js).
- Prefer async/await over chained promises.
- Normalize errors (clear message + logged stack).
- No TypeScript transpilation.

### Framework-Specific Rules
- Express (ESM) with app.use to mount modules.
- Monitoring module lives in monitor/ (routes + logic).
- Bearer auth middleware on /monitor and /monitor/stream.
- SSE headers: Content-Type: text/event-stream, Cache-Control: no-store, Connection: keep-alive.
- Do not introduce WebSocket without explicit decision.
- Monitoring routes separated from existing routes/.

### Testing Rules
- No test framework required for now.
- If tests are added: focused unit tests (helpers, buffer, auth).
- No E2E required for MVP.

### Code Quality & Style Rules
- Simple JS, no TypeScript.
- Asset files in kebab-case; variables in camelCase.
- Logs structured as { ts, level, message, context }.
- Avoid adding new dependencies without need.

### Development Workflow Rules
- No enforced commit/branch format.
- Local run via npm run dev.
- Required env vars: MONITOR_ENABLED, MONITOR_TOKEN.
- Render deployment via existing Dockerfile.

### Critical Don't-Miss Rules
- Never expose /monitor publicly (auth required).
- Do not depend on Render API for logs.
- Do not add WebSocket without explicit decision.
- No disk persistence for logs at MVP.
- Enforce FIFO buffer (500 logs / 5 min).
- Always emit SSE error event for error-level logs.

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code.
- Follow ALL rules exactly as documented.
- When in doubt, prefer the more restrictive option.
- Update this file if new patterns emerge.

**For Humans:**
- Keep this file lean and focused on agent needs.
- Update when technology stack changes.
- Review quarterly for outdated rules.
- Remove rules that become obvious over time.

Last Updated: 2026-01-19T11:59:48.492680Z

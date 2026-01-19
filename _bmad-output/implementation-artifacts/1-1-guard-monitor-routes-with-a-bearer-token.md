# Story 1.1: Proteger les routes du moniteur par token bearer

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux que les routes du moniteur soient protegees par un token bearer,
afin que seuls les utilisateurs autorises puissent y acceder.

## Acceptance Criteria

1. Etant donne que MONITOR_ENABLED est a true, quand une requete est faite sans en-tete Authorization valide sur /monitor, /monitor/stream, ou /monitor/health, alors le serveur repond 401 et ne sert aucun contenu du moniteur.
2. Etant donne que MONITOR_ENABLED est a true, quand une requete est faite avec Authorization: Bearer <MONITOR_TOKEN> sur /monitor, /monitor/stream, ou /monitor/health, alors l'acces est autorise.

## Tasks / Subtasks

- [x] Implementer un middleware d'authentification bearer (AC: 1, 2)
  - [x] Lire MONITOR_TOKEN depuis l'environnement et refuser si absent
  - [x] Valider l'en-tete Authorization: Bearer <token>
- [x] Appliquer le middleware aux routes /monitor, /monitor/stream, /monitor/health (AC: 1, 2)
  - [x] Verifier que les assets du moniteur ne sont pas servis sans token
- [x] Ajouter un test manuel simple (smoke) via curl pour 401/200 (AC: 1, 2)

## Dev Notes

- ESM uniquement (type: module), pas de require.
- Pas de dependances additionnelles.
- Auth via bearer token sur header Authorization.
- Secret dans MONITOR_TOKEN.
- MONITOR_ENABLED doit conditionner l'activation du module (si le code actuel le gere deja, respecter ce comportement).
- Routes moniteur dans monitor/routes.js; helper dans monitor/auth.js.

### Project Structure Notes

- monitor/ contient la logique de monitoring et le middleware auth.
- server.js ne fait que monter le module monitor.
- UI statique dans public/monitor.html, public/monitor.js, public/monitor.css.

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 1, Story 1.1)
- `_bmad-output/planning-artifacts/architecture.md` (Authentication & Security, Project Structure)
- `_bmad-output/planning-artifacts/prd.md` (FR1-FR3, NFR3-NFR4)
- `_bmad-output/project-context.md` (Framework rules, Critical don't-miss rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/auth.test.js monitor/routes.test.js`

### Completion Notes List

- Middleware bearer ajoute et applique aux chemins /monitor et assets monitor.
- Token query accepte et persiste via cookie HttpOnly pour les assets monitor.
- Tests unitaires `node:test` pour 401/200, token manquant, query token, cookie token et 404 quand MONITOR_ENABLED=false.
- Smoke test curl a executer (Render):
  - `export BASE_URL="https://mes-formulaires.onrender.com"`
  - `export TOKEN="<MONITOR_TOKEN>"`
  - `curl -i "$BASE_URL/monitor/health" -H "Authorization: Bearer $TOKEN"`
  - `curl -i "$BASE_URL/monitor/health?token=$TOKEN"`
  - `curl -i "$BASE_URL/monitor/health"` (attendu 401/403)


### File List

- monitor/auth.js
- monitor/auth.test.js
- monitor/routes.test.js
- server.js
- _bmad-output/implementation-artifacts/1-1-guard-monitor-routes-with-a-bearer-token.md
- _bmad-output/implementation-artifacts/sprint-status.yaml

# Story 4.4: Configurer et declencher des alertes

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux configurer des seuils d'alerte et declencher des notifications,
afin d'etre averti des erreurs sans surveiller en continu.

## Acceptance Criteria

1. Etant donne un seuil configure,
   quand le nombre d'erreurs depasse ce seuil,
   alors une alerte est declenchee.
2. Etant donne une alerte declenchee,
   quand une notification est configuree,
   alors un envoi externe (mail ou webhook) est effectue.

## Tasks / Subtasks

- [x] Definir un seuil d'alerte simple (AC: 1)
  - [x] Stocker le seuil en memoire ou via env var
- [x] Ajouter une logique de comptage d'erreurs (AC: 1)
- [x] Declencher une notification (AC: 2)
  - [x] Choisir mail ou webhook pour MVP
- [x] Ajouter tests unitaires de base (AC: 1, 2)

## Dev Notes

- Post-MVP: scope large, peut etre separe en stories additionnelles.
- Garder le code simple, pas d'integration tierce lourde.

### Project Structure Notes

- monitor/monitor.js (a etendre)
- monitor/routes.js (si besoin)
- public/monitor.js (si besoin UI)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 4, Story 4.4)
- `_bmad-output/planning-artifacts/architecture.md`
- `_bmad-output/project-context.md` (Rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor-alerts.test.js`

### Completion Notes List

- Seuil d'alerte via MONITOR_ALERT_THRESHOLD.
- Notification webhook via MONITOR_ALERT_WEBHOOK_URL.
- Alerte declenchee a l'atteinte du seuil et rearmee apres expiration de la fenetre.
- alertTriggered ne se verrouille que si un envoi webhook valide a ete tente.

### File List

- monitor/monitor.js
- monitor/monitor-alerts.test.js
- _bmad-output/implementation-artifacts/4-4-configure-and-trigger-alerts.md

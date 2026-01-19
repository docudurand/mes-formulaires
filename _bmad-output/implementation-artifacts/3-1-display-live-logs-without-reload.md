# Story 3.1: Afficher les logs en direct sans rechargement

Status: done

<!-- Note: Validation optional. Run validate-create-story for quality check before dev-story. -->

## Story

En tant qu'administrateur,
je veux que la page /monitor ajoute les logs au fil de l'eau,
afin de suivre l'activite en temps reel sans recharger.

## Acceptance Criteria

1. Etant donne que la page /monitor est ouverte,
   quand un event SSE "log" arrive,
   alors une nouvelle ligne est ajoutee au DOM sans rechargement.
2. Etant donne que la liste depasse la limite affichee,
   quand de nouvelles entrees arrivent,
   alors les plus anciennes sont supprimees du DOM.

## Tasks / Subtasks

- [x] Implementer la reception SSE dans public/monitor.js (AC: 1)
  - [x] Ouvrir EventSource sur /monitor/stream
  - [x] Ecouter event "log" et parser JSON
  - [x] Ajouter la ligne au DOM
- [x] Limiter le nombre de lignes affichees (AC: 2)
  - [x] Definir une limite (ex: 200)
  - [x] Supprimer les plus anciennes au-dela de la limite
- [x] Ajouter un affichage minimal (liste des logs) (AC: 1)
  - [x] Conteneur DOM avec append (ul/div)
  - [x] Format simple: [ts] [level] message

## Dev Notes

- JS sans framework.
- Ne pas implementer filtres avancees ici.
- Utiliser EventSource (SSE).
- Pas de dependances.

### Project Structure Notes

- public/monitor.js (a etendre)
- public/monitor.html (ajouter un conteneur log)

### References

- `_bmad-output/planning-artifacts/epics.md` (Epic 3, Story 3.1)
- `_bmad-output/planning-artifacts/architecture.md` (Frontend Architecture)
- `_bmad-output/project-context.md` (Rules)

## Dev Agent Record

### Agent Model Used

GPT-5

### Debug Log References

 - `node --test monitor/monitor-client.test.js`

### Completion Notes List

- EventSource vers /monitor/stream et append des logs au DOM.
- Limitation a 200 lignes visibles avec eviction des plus anciennes.
- Statut "En ligne" + gestion erreur SSE ("Flux interrompu").
- Prefixes textuels INFO/WARN/ERROR pour accessibilite.

### File List

- public/monitor.html
- public/monitor.js
- public/monitor.css
- monitor/monitor-client.test.js
- _bmad-output/implementation-artifacts/3-1-display-live-logs-without-reload.md

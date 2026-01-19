# Data Models (fichiers/JSON)

## Compteurs (compteur.js)
Fichier local: compteurs.json (sync FTP). Structure normalisee:
{
  "ramasseMagasins": {
    "MAGASIN": { "total": number, "byYear": { "2025": number } }
  },
  "forms": {
    "piece":   { "total": number, "byYear": { "2025": number } },
    "piecepl": { "total": number, "byYear": { "2025": number } },
    "pneu":    { "total": number, "byYear": { "2025": number } }
  }
}

## Presences (routes/presences.js)
FTP: /presences/{YYYY-MM}/{MAGASIN}.json
Structure par jour:
{
  "YYYY-MM-DD": {
    "data": {
      "rows": [
        { "label": "NOM PRENOM", "values": { "Matin": "CP", "A. Midi": "" } }
      ]
    },
    "savedAt": "ISO"
  }
}

FTP: /presences/leaves.json
Liste des demandes conges. Champs observes:
{
  "id": string,
  "magasin": string,
  "nom": string,
  "prenom": string,
  "dateDu": "YYYY-MM-DD",
  "dateAu": "YYYY-MM-DD",
  "nbJours": number,
  "status": "pending|accepted|rejected|cancelled",
  "reason": string,
  "tokens": { "resp_service": string|null, "resp_site": string|null },
  "signedService": { "at": "ISO", "by": string }?,
  "signedSite": { "at": "ISO", "by": string }?,
  "pdfPath": string?
}

## Visits (visits.js)
Fichier local data/visits.json (+ FTP analytics/visits.json):
{
  "total": number,
  "byDate": { "YYYY-MM-DD": number },
  "updatedAt": "ISO"
}

## Mail queue (mailQueue.js)
Dossiers: mail-queue/ready, done, failed
Format job:
{
  "jobId": string,
  "idempotencyKey": string,
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "status": "queued|sending|sent",
  "attempts": number,
  "nextAttemptAt": number,
  "payload": {
    "mailOptions": { "to": string|array, "subject": string, "html": string, ... },
    "formType": string,
    "meta": object,
    "cleanupPaths": [string]
  }
}

## Pret vehicule (pretvehiculed)
Les donnees sont portees par Apps Script via API (pas de stockage local persistant).

## Mail logs (mailLog.js)
Logs stockes dans Apps Script (GS_MAIL_LOG_URL) via appendMailLog.

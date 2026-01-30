# Mes Formulaires - Projet Fusionné

## Vue d'ensemble

Ce projet fusionne les deux applications **mes-formulaires** et **warrantydurand** en une seule application unifiée. Toutes les fonctionnalités de garantie sont maintenant intégrées dans le serveur principal.

## Changements Majeurs

### 1. Module Garantie Intégré

Le module de garantie (anciennement `warrantydurand`) est maintenant situé dans le dossier `garantie-module/` et est monté sur le chemin `/api/garantie`.

### 2. Variable d'Environnement Modifiée

⚠️ **IMPORTANT** : La variable `FTP_BACKUP_FOLDER` a été renommée en `GARANTIE_FTP_BACKUP_FOLDER` pour éviter les conflits avec d'autres modules.

```env
# Ancien (dans warrantydurand)
FTP_BACKUP_FOLDER=/Disque 1/sauvegardegarantie

# Nouveau (dans mes-formulaires fusionné)
GARANTIE_FTP_BACKUP_FOLDER=/Disque 1/sauvegardegarantie
```

### 3. Routes API

Toutes les routes de garantie sont préfixées par `/api/garantie` :

- `/api/garantie/demandes` - Créer une demande de garantie
- `/api/garantie/admin/dossiers` - Liste des dossiers (admin)
- `/api/garantie/admin/dossier/:id` - Modifier un dossier (admin)
- `/api/garantie/admin/export-excel` - Export Excel des dossiers
- `/api/garantie/download/:filename` - Télécharger un fichier
- `/api/garantie/login` - Authentification admin
- `/api/garantie/admin` - Page d'administration

### 4. Pages Publiques

Les pages publiques de garantie sont accessibles via :

- `/garantie/demande.html` - Formulaire de demande de garantie client
- `/garantie/saisie.html` - Page de saisie rapide
- `/gestion-garantie.html` - Interface admin (iframe vers `/api/garantie/admin`)

### 5. Fichiers de Formulaires Fournisseurs

Les formulaires PDF des fournisseurs sont dans `/garantie/formulaire/` :

- FICHE_GARANTIE_FEBI.pdf
- formulaire_garantie_metelli.pdf
- Formulaire_EFI.pdf
- FORMULAIRE_MAGNETI.pdf
- FORMULAIRE_QH.pdf
- DEMANDE_RIAL.pdf
- Formulaire_ AUTOGAMMA.pdf
- Formulaire_delphi.pdf
- FORMULAIRE_ms.pdf
- Formulaire_ngk.pdf
- Formulaire_nrf.pdf
- Formulaire_SEIM.pdf

## Structure des Dossiers

```
mes-formulaires-fusionned/
├── garantie/                      # Pages publiques garantie
│   ├── demande.html              # Formulaire client
│   ├── saisie.html               # Saisie rapide
│   ├── admin-garantie.html       # Page admin (servie par le module)
│   └── formulaire/               # PDFs fournisseurs
├── garantie-module/              # Module Express pour la garantie
│   └── routes.js                 # Routes et logique métier
├── server.js                     # Serveur principal
├── .env                          # Variables d'environnement
└── package.json                  # Dépendances
```

## Installation et Déploiement

### 1. Variables d'Environnement

Copier le fichier `.env` fourni et s'assurer que toutes les variables sont correctement configurées, notamment :

```env
# Configuration FTP
FTP_HOST=documentsd.freeboxos.fr
FTP_PORT=44690
FTP_USER=freebox
FTP_PASS=Pichard2007

# Dossier de sauvegarde garantie (ATTENTION : variable renommée !)
GARANTIE_FTP_BACKUP_FOLDER=/Disque 1/sauvegardegarantie

# Configuration SMTP
SMTP_HOST=ssl0.ovh.net
SMTP_PORT=587
SMTP_USER=noreply@documentsdurand.fr
SMTP_PASS=N@elys2007

# Mails des magasins et fournisseurs
MAGASIN_MAILS_JSON=`{...}`
FOURNISSEUR_MAILS_JSON='{"FEBI":"...", ...}'
```

### 2. Installation des Dépendances

```bash
npm install
```

### 3. Lancement

```bash
npm start
```

Le serveur démarre sur le port défini dans `process.env.PORT` (par défaut 3000).

### 4. Déploiement sur Render

1. Créer un nouveau Web Service sur Render
2. Connecter le repository GitHub
3. Configurer les variables d'environnement dans Render (copier depuis le fichier `.env`)
4. Déployer

⚠️ **IMPORTANT** : Ne pas oublier de mettre à jour la variable `GARANTIE_FTP_BACKUP_FOLDER` dans Render !

## Migration depuis l'Ancien Système

Si vous migrez depuis l'ancien système avec deux serveurs séparés :

1. ✅ Les données FTP restent au même emplacement (`/Disque 1/sauvegardegarantie`)
2. ✅ Le fichier `demandes.json` n'a pas besoin d'être modifié
3. ✅ Les fichiers uploadés restent dans `/Disque 1/sauvegardegarantie/uploads`
4. ⚠️ Mettre à jour l'URL dans `gestion-garantie.html` si nécessaire
5. ⚠️ Vérifier que toutes les variables d'environnement sont correctement configurées

## Points d'Attention

### Authentification

Les mots de passe magasin/admin restent les mêmes :

```env
admin-pass=Gleize69400!
superadmin-pass=Pich@rd2007
magasin-Gleize-pass=GLEIZE258
# etc.
```

### Emails

Le système utilise deux configurations email possibles :
1. SMTP (OVH) - prioritaire
2. Gmail (fallback)

### FTP

Le système se connecte au FTP Freebox avec :
- Connexion sécurisée (TLS)
- Timeout de 10 secondes
- Gestion des erreurs "FIN packet unexpectedly"

## Fonctionnalités Garantie

- ✅ Création de demandes de garantie
- ✅ Upload de pièces jointes (photos, factures, etc.)
- ✅ Génération automatique de PDF récapitulatif
- ✅ Envoi d'emails au client et au magasin
- ✅ Interface d'administration pour gérer les dossiers
- ✅ Modification du statut (enregistré, accepté, refusé, etc.)
- ✅ Ajout de réponses et documents complémentaires
- ✅ Export Excel des dossiers
- ✅ Téléchargement des pièces jointes
- ✅ Suppression de dossiers (superadmin uniquement)

## Support

Pour toute question ou problème, contacter l'équipe de développement.

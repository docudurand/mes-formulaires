# Guide de Migration - Fusion mes-formulaires + warrantydurand

## ⚠️ CHANGEMENTS CRITIQUES

### 1. Variable d'Environnement RENOMMÉE

**AVANT (warrantydurand) :**
```env
FTP_BACKUP_FOLDER=/Disque 1/sauvegardegarantie
```

**APRÈS (mes-formulaires fusionné) :**
```env
GARANTIE_FTP_BACKUP_FOLDER=/Disque 1/sauvegardegarantie
```

**⚠️ ACTION REQUISE :** 
- Sur Render.com, renommer la variable d'environnement `FTP_BACKUP_FOLDER` en `GARANTIE_FTP_BACKUP_FOLDER`
- Vérifier que la valeur reste `/Disque 1/sauvegardegarantie`

### 2. URL de l'Interface Admin

**AVANT :**
```
https://durandservicesgarantie.onrender.com/admin
```

**APRÈS :**
```
https://[votre-domaine]/api/garantie/admin
OU
https://mes-formulaires.onrender.com/api/garantie/admin
```

Le fichier `gestion-garantie.html` a été mis à jour pour pointer vers `/api/garantie/admin` (chemin relatif).

### 3. APIs Garantie

Toutes les routes sont maintenant préfixées par `/api/garantie` :

| Ancienne Route | Nouvelle Route |
|---------------|----------------|
| `/api/demandes` | `/api/garantie/demandes` |
| `/api/admin/dossiers` | `/api/garantie/admin/dossiers` |
| `/api/admin/dossier/:id` | `/api/garantie/admin/dossier/:id` |
| `/api/download/:filename` | `/api/garantie/download/:filename` |
| `/api/login` | `/api/garantie/login` |
| `/admin` | `/api/garantie/admin` |

**⚠️ IMPACT :** 
- Les formulaires de demande (`garantie/demande.html`) ont été mis à jour
- L'iframe dans `gestion-garantie.html` a été mise à jour
- Aucune autre modification externe n'est requise

## Checklist de Déploiement

### Étape 1 : Préparer l'Environnement

- [ ] Vérifier que toutes les variables d'environnement sont présentes dans le `.env`
- [ ] Particulièrement vérifier `GARANTIE_FTP_BACKUP_FOLDER`
- [ ] Vérifier `FOURNISSEUR_MAILS_JSON` et `MAGASIN_MAILS_JSON`

### Étape 2 : Sur Render.com

- [ ] Supprimer l'ancien service `durandservicesgarantie` (ou le désactiver)
- [ ] Dans le service `mes-formulaires` :
  - [ ] Ajouter la variable `GARANTIE_FTP_BACKUP_FOLDER=/Disque 1/sauvegardegarantie`
  - [ ] Vérifier que toutes les autres variables de garantie sont présentes
  - [ ] Redéployer

### Étape 3 : Tests

- [ ] Accéder à `/garantie/demande.html` - le formulaire doit s'afficher
- [ ] Créer une demande de garantie test
- [ ] Vérifier que l'email est bien reçu
- [ ] Vérifier que le PDF est généré
- [ ] Accéder à `/gestion-garantie.html` - l'iframe doit charger l'admin
- [ ] Se connecter avec un compte admin
- [ ] Vérifier que les dossiers s'affichent
- [ ] Modifier un dossier test
- [ ] Vérifier l'export Excel

### Étape 4 : Vérifications FTP

- [ ] Se connecter au FTP et vérifier `/Disque 1/sauvegardegarantie/demandes.json`
- [ ] Vérifier que les nouveaux fichiers sont bien uploadés dans `uploads/`
- [ ] Vérifier que le téléchargement de fichiers fonctionne

## Rollback en Cas de Problème

Si quelque chose ne fonctionne pas :

1. **Redémarrer l'ancien service warrantydurand sur Render**
2. **Remettre l'ancienne URL dans gestion-garantie.html** :
   ```html
   src="https://durandservicesgarantie.onrender.com/admin"
   ```
3. **Investiguer le problème dans les logs du nouveau serveur**

## Différences avec l'Ancien Système

| Aspect | Ancien (2 serveurs) | Nouveau (1 serveur) |
|--------|---------------------|---------------------|
| Serveurs | mes-formulaires + warrantydurand | mes-formulaires uniquement |
| Base URL garantie | durandservicesgarantie.onrender.com | [domaine]/api/garantie |
| Variable FTP | FTP_BACKUP_FOLDER | GARANTIE_FTP_BACKUP_FOLDER |
| Données FTP | `/Disque 1/sauvegardegarantie` | `/Disque 1/sauvegardegarantie` (identique) |
| Structure JSON | Identique | Identique |
| Authentification | Identique | Identique |

## Avantages de la Fusion

✅ **Un seul serveur à gérer** - Moins de complexité opérationnelle
✅ **Même .env** - Toutes les configurations au même endroit
✅ **Partage du code mailer** - Pas de duplication
✅ **Meilleure cohérence** - Même style de code, mêmes patterns
✅ **Coûts réduits** - Un seul service Render au lieu de deux
✅ **Déploiements simplifiés** - Un seul repository à déployer

## Support Technique

En cas de problème :

1. Vérifier les logs du serveur sur Render
2. Vérifier les variables d'environnement
3. Vérifier la connexion FTP
4. Vérifier la configuration SMTP
5. Tester localement avec le `.env` complet

## Contact

Pour toute question : magvl4gleize@durandservices.fr

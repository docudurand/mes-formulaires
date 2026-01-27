# AGENTS — Workflow BMAD (annotations débutant)

## Objectif
Je veux ajouter des annotations dans mon code pour comprendre :
- à quoi servent les fichiers, fonctions, variables, et sections
- comment débuguer et modifier moi-même plus tard

Les annotations doivent être écrites comme si c’était moi (débutant) qui les avais ajoutées.

## Règles d’annotation (très important)
1. Ne pas casser le code : aucune modification de logique si ce n’est pas nécessaire.
2. Ne pas renommer les fonctions/variables si le projet fonctionne.
3. Ajouter des commentaires courts et simples, en français.
4. Préférer :
   - des commentaires au-dessus des fonctions
   - des commentaires au-dessus des gros blocs (ex: chargement données, génération PDF, envoi mail, etc.)
5. Éviter les commentaires inutiles sur du code évident (ex: `i++`).
6. Ajouter aussi un mini en-tête en haut de chaque fichier expliquant :
   - ce que fait le fichier
   - où il est utilisé (page admin, demande.html, suivi.html, serveur, etc.)
7. Si une partie du code est “fragile” ou source d’erreur, ajouter un commentaire du style :
   - "⚠️ Attention : ici ça casse si ..."
8. Si tu as un doute, ajouter un commentaire "TODO" clair.

## Style de commentaires (comme moi, débutant)
Utiliser un ton simple :
- "Ici je récupère les données..."
- "Cette fonction sert à..."
- "Je pense que..."
- "⚠️ Je dois faire attention à..."

Exemples :
- // ✅ Récupère les prix depuis Google Sheets (via l’API Apps Script)
- // ⚠️ Si l’email est invalide, l’envoi peut échouer
- // TODO: vérifier si la pièce jointe existe avant d’envoyer

## Plan de travail (workflow)
1. Lire l’arborescence du projet et lister les fichiers importants.
2. Pour chaque fichier :
   - ajouter un en-tête explicatif en haut du fichier
   - annoter les fonctions principales
   - annoter les “étapes” du traitement (ex: fetch, parse, render, submit, PDF, mail)
3. Ne rien supprimer.
4. Si une amélioration est évidente pour éviter un bug, la proposer en commentaire TODO (sans modifier la logique).
5. Finir par un résumé des fichiers annotés + points importants.

## Livrables attendus
- Tous les fichiers annotés
- Les fichiers restent fonctionnels
- Un récap de ce qui a été annoté et où chercher quand je débugue

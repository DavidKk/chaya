# Chaya : préparer et lancer un jeu

## Préparation

1. **local** (App / développement) : choisir `www`, son dossier de distribution parent ou un paquet macOS `.app` / Windows `Game.exe` dans la bibliothèque. La racine MV / MZ est détectée. Retirer une entrée ne supprime que l’enregistrement.
2. **cloud** : autoriser la lecture et l’écriture du dossier avec `www` ou `index.html` dans Chrome / Microsoft Edge.
3. Installer l’environnement NW.js partagé depuis les détails (environ 100 Mo) ; inutile si le jeu possède le sien.
4. Installer les extensions et redémarrer le jeu après chaque mise à jour. Le lancement local les injecte aussi automatiquement.

Si l’environnement macOS ne s’ouvre pas, quitter le jeu, exécuter dans le Terminal, suivre le choix du dossier, puis ouvrir `Chaya.app`. Les sauvegardes sont conservées et l’ancien environnement est sauvegardé :

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
```

## Extensions et utilisation

`ChayaLoader` charge avec cache hors ligne ; `ChayaLog` journalise ; `ChayaTrans` traduit ; `ChayaBoost` règle la vitesse (`on()` / `off()`) ; `ChayaEdit` modifie, téléporte et sauvegarde / charge (`help()`) ; `ChayaAgent` relie les commandes du jeu.

- **local** : Bibliothèque → Lancer écrit la configuration de session et ouvre le jeu ; l’extension rejoint le service local et la console affiche son état.
- **cloud** : après préparation, ouvrir `Chaya.app` / `Chaya` près du dossier du jeu. Communication WebRTC ; la page ne peut pas lancer de processus.
- Modification (`/cheat`) : argent, objets, variables, interrupteurs, personnages, invincibilité, traversée des murs, vitesse, téléportation, sauvegarde / chargement. Le raccourci du jeu ouvre le même panneau.
- Traduction (`/translate`) : extraire le seed → compléter le jeu avec les moteurs activés et les réglages de planification ; pause possible. Consulter, rechercher, modifier, supprimer ou importer le cache. Modes : prétraduction, temps réel, sous-titres. Les tâches Cloud passent par le jeu connecté ; la bibliothèque locale partagée exige local.
- Journaux (`/logs`) : filtrer par source et niveau. Quitter depuis la console ou fermer la fenêtre. Demander l’accord avant de quitter pour l’utilisateur, modifier de façon destructive, effacer les extensions, écraser une sauvegarde ou charger.

## Dépannage

Installer l’environnement manquant. Si les extensions restent inactives, réinstaller, redémarrer et examiner `ChayaLoader`. Hors ligne : vérifier le chargement de `ChayaAgent` et sa configuration, puis actualiser la console. Sur macOS, utiliser si nécessaire la réparation ci-dessus.

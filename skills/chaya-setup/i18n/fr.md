# Chaya : installation et modes

Chaya gère les jeux RPG Maker, NW.js, les extensions, les modifications, la traduction, les journaux et MCP.

## Choisir un mode

- **local** : App (macOS / Windows) ou développement local ; bibliothèque complète, lancement, traduction locale et MCP. Les données de l’App sont dans le dossier système de l’application.
- **cloud** : ouvrir `https://chaya-gray.vercel.app` dans Chrome / Microsoft Edge, autoriser la lecture et l’écriture d’un dossier contenant `www` ou `index.html`, puis installer extensions et environnement NW.js. Lancer le jeu soi-même. Le navigateur ne lance pas de processus et ne fournit ni modèles locaux ni bibliothèque partagée du service local.
- **plugin** : fonctionne dans le jeu ouvert, sans console. MCP propose commandes du jeu, modifications, traduction, cache, journaux et connaissances du jeu ; pas de gestion de bibliothèque, lancement, batch ou eval. Cloud utilise `chaya_translate_job` du jeu connecté pour compléter la traduction.

## Installer l’App / le développement

Choisir Apple Silicon, Intel Mac ou Windows x64 dans les téléchargements de l’accueil. Installation dans le Terminal macOS :

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

Sinon, décompresser et glisser `Chaya.app` dans Applications. Si elle est dite « endommagée », exécuter `xattr -cr /Applications/Chaya.app` ou clic droit → Ouvrir → Ouvrir. Sous Windows, décompresser et lancer `Chaya.exe`. Console App par défaut : `http://127.0.0.1:3927`.

Développement : Node ≥ 22.19 et pnpm 9 :

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

Ouvrir `http://localhost:3000`. `pnpm dev:lan` autorise le LAN ; `pnpm dev:app` inclut Electron. Le sélecteur de développement propose Local / Cloud ; les changements de sources reconstruisent les extensions.

## Accès et dépannage

Aucune connexion de compte. L’API locale accepte uniquement les requêtes de même origine depuis localhost, une IP ou `CHAYA_PUBLIC_ORIGIN`. Pour une erreur 401 sur un nom personnalisé, définir cette variable et redémarrer. Le jeton d’extension est limité à sa session ; redémarrer le jeu après mise à jour. Si 3000 / 3927 sont occupés, fermer les autres instances ou définir `PORT` pour l’App.

MCP : `http://127.0.0.1:39271/mcp`. Après changement de port dans Intégration → MCP du jeu, mettre à jour le client. Quand local fonctionne, la passerelle transmet au MCP local. Pour choisir un dossier Cloud, utiliser Chrome / Microsoft Edge de bureau et donner l’autorisation ; ouvrir ensuite `Chaya.app` / `Chaya` sur l’ordinateur.

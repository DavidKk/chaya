# Chaya: Installation und Betriebsarten

Chaya verwaltet RPG-Maker-Spiele, NW.js, Plugins, Bearbeitung, Übersetzung, Protokolle und MCP.

## Betriebsart wählen

- **local**: App (macOS / Windows) oder lokale Entwicklung; vollständige Bibliothek, Spielstart, lokale Übersetzung und MCP. App-Daten liegen im Anwendungsordner des Systems.
- **cloud**: `https://chaya-gray.vercel.app` in Chrome / Microsoft Edge öffnen, Lese- und Schreibzugriff auf einen Ordner mit `www` oder `index.html` erlauben und Plugins sowie Shell installieren. Das Spiel selbst starten. Die Webseite bietet weder Prozessstart noch lokale Modelle oder die gemeinsame Bibliothek des lokalen Dienstes.
- **plugin**: läuft im geöffneten Spiel, auch ohne Konsole. MCP bietet Spielsteuerung, Bearbeitung, Übersetzung, Cache, Protokolle und Spielwissen; keine Bibliotheksverwaltung, kein Start, batch oder eval. Cloud-Nachübersetzung nutzt `chaya_translate_job` des verbundenen Spiels.

## App und Entwicklung installieren

Im Downloadbereich Apple Silicon, Intel Mac oder Windows x64 wählen. Installation im macOS-Terminal:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/install.sh)"
```

Alternativ entpacken und `Chaya.app` nach Programme ziehen. Bei „beschädigt“ `xattr -cr /Applications/Chaya.app` ausführen oder Rechtsklick → Öffnen → Öffnen. Unter Windows entpacken und `Chaya.exe` starten. App-Konsole standardmäßig: `http://127.0.0.1:3927`.

Entwicklung benötigt Node ≥ 22.19 und pnpm 9:

```bash
git clone https://github.com/DavidKk/chaya.git
cd chaya
pnpm i
pnpm dev
```

`http://localhost:3000` öffnen. `pnpm dev:lan` erlaubt LAN-Zugriff, `pnpm dev:app` startet mit Electron. Der Entwicklungsschalter bietet Local / Cloud; Quelländerungen bauen Plugins neu.

## Zugriff und Fehler

Keine Anmeldung. Die lokale API akzeptiert nur gleichursprüngliche Anfragen von localhost, IP-Adressen oder `CHAYA_PUBLIC_ORIGIN`. Bei 401 mit eigenem Hostnamen diese Variable setzen und neu starten. Plugin-Starttoken gelten nur für ihre Sitzung; nach Updates das Spiel neu starten. Bei belegten Ports 3000 / 3927 andere Instanzen beenden oder App-`PORT` setzen.

MCP: `http://127.0.0.1:39271/mcp`. Nach einer Portänderung unter Integration → MCP im Spiel auch den Client anpassen. Läuft local, leitet das Gateway an den lokalen MCP weiter. Für die Cloud-Ordnerauswahl Desktop-Chrome / Microsoft Edge und eine Freigabe verwenden; danach `Chaya.app` / `Chaya` auf dem Computer öffnen.

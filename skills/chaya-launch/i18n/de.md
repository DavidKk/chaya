# Chaya: Spiel vorbereiten und starten

## Vorbereitung

1. **local** (App / Entwicklung): In der Bibliothek `www`, den übergeordneten Veröffentlichungsordner oder ein Paket mit macOS `.app` / Windows `Game.exe` wählen. MV-/MZ-Inhaltsordner werden erkannt. Entfernen aus der Bibliothek löscht nur den Eintrag.
2. **cloud**: In Chrome / Microsoft Edge Lese- und Schreibzugriff auf einen Ordner mit `www` oder `index.html` erlauben.
3. In den Bibliotheksdetails die gemeinsame NW.js-Shell installieren (etwa 100 MB); bei vorhandener Spiel-Shell nicht nötig.
4. Plugins installieren und nach jedem Update das Spiel neu starten. Ein lokaler Start installiert Plugins auch automatisch.

Öffnet sich die macOS-Shell nicht: Spiel beenden, im Terminal ausführen, den Ordner nach Anleitung wählen und `Chaya.app` öffnen. Spielstände bleiben erhalten, die alte Shell wird gesichert:

```bash
/bin/bash -c "$(curl -fsSL https://chaya-gray.vercel.app/sh/mac-shell.sh)"
```

## Plugins und Verwendung

`ChayaLoader` lädt Plugins mit Offline-Cache, `ChayaLog` protokolliert, `ChayaTrans` übersetzt, `ChayaBoost` ändert das Tempo (`on()` / `off()`), `ChayaEdit` bearbeitet, teleportiert und speichert / lädt (`help()`), `ChayaAgent` verbindet die Spielsteuerung.

- **local**: Bibliothek → Starten schreibt die Sitzungskonfiguration und öffnet das Spiel. Das Plugin verbindet sich zum lokalen Dienst; die Konsole zeigt den Status.
- **cloud**: Nach der Vorbereitung `Chaya.app` / `Chaya` neben dem Spielordner öffnen. Die Verbindung nutzt WebRTC; Webseiten starten keine Prozesse.
- Bearbeitung (`/cheat`): Geld, Gegenstände, Variablen, Schalter, Figuren, Unverwundbarkeit, Wände durchqueren, Tempo, Teleport und Speichern / Laden. Der Spiel-Hotkey öffnet dasselbe Bedienfeld.
- Übersetzung (`/translate`): Ausgangstext extrahieren → Gesamtauftrag mit aktivierten Engines und Zeitplanung starten; pausierbar. Cache durchsuchen, bearbeiten, löschen oder importieren. Spielmodi: Vorübersetzung, Echtzeit, Untertitel. Cloud-Aufträge laufen im verbundenen Spiel, die lokale gemeinsame Bibliothek benötigt local.
- Protokolle (`/logs`): nach Quelle und Stufe filtern. Über Konsole oder Fenster schließen. Vor stellvertretendem Beenden, zerstörenden Änderungen, Plugin-Löschung, Überschreiben von Spielständen oder Laden Zustimmung einholen.

## Fehlerbehebung

Fehlende Shell installieren. Unwirksame Plugins neu installieren, Spiel neu starten und `ChayaLoader`-Protokolle prüfen. Bei Offline-Status `ChayaAgent` und Verbindungseinstellungen prüfen, dann die Konsole aktualisieren. Unter macOS bei Bedarf den Reparaturbefehl oben verwenden.

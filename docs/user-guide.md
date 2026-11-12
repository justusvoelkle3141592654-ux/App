# Benutzerhandbuch

Dieses Handbuch beschreibt die Version 1.0.0 in deutscher Sprache. Die App ist auch auf Englisch verfügbar (Einstellungen, Sprache).

## Start

1. `DesktopOrganizer.exe` doppelklicken. Es ist keine Installation nötig.
2. Im Startfenster ein Werkzeug auswählen, mit Doppelklick oder Enter. Jedes Werkzeug öffnet sein eigenes Fenster. Esc schließt das Fenster.
3. Oben in der Suche können Werkzeuge und Notizen gefunden werden.

Die App braucht keine Administratorrechte und verbindet sich nicht mit dem Internet.

## Wo liegen die Daten?

Standardmäßig in `%APPDATA%\DesktopOrganizer`. Wenn neben der `.exe` eine Datei `portable.flag` liegt, werden die Daten im Ordner `data` neben der `.exe` gespeichert. Der Ordner lässt sich in den Einstellungen öffnen.

## Werkzeuge

### Dateien sortieren

1. Ordner wählen, zum Beispiel Downloads.
2. „Vorschau erstellen“ anklicken. Die Liste zeigt jede geplante Verschiebung.
3. „Dateien verschieben“ anklicken und bestätigen.
4. Mit „Letzten Lauf rückgängig machen“ gehen die Dateien an ihren ursprünglichen Ort zurück.

Es werden nur Dateien direkt im Ordner sortiert, Unterordner bleiben unverändert. Dateien landen in den Ordnern Bilder, Dokumente, Videos, Audio, Archive, Programme oder Sonstiges.

### Backup

1. Quellordner mit „Ordner hinzufügen“ auswählen.
2. Zielordner wählen, zum Beispiel eine externe Festplatte.
3. „Vorschau erstellen“ zeigt, wie viele Dateien neu oder geändert sind.
4. „Backup starten“ kopiert nur diese Dateien. Jede Kopie wird mit SHA-256 geprüft.
5. Im Zielordner liegt ein Protokoll `_backup-log-…txt`.

Im Ziel wird nichts gelöscht. Dateien, die nur im Ziel liegen, bleiben erhalten.

### Passwort-Generator

- Länge und Zeichenarten einstellen, dann „Neu erzeugen“ anklicken. Beim Öffnen und beim Umschalten auf Passphrase wird automatisch ein Passwort erzeugt.
- „Passphrase statt Passwort“ erzeugt Wörter, getrennt durch ein Zeichen Ihrer Wahl.
- „Kopieren“ legt das Passwort in die Zwischenablage. Nach 30 Sekunden wird die Zwischenablage geleert, sofern dort noch dasselbe Passwort steht.
- Passwörter werden nirgends gespeichert.

### Notizen

- Links die Liste, rechts der Editor. Mit Strg+N beginnt eine neue Notiz, mit Strg+S wird gespeichert.
- Schlagwörter mit `#` im Text, zum Beispiel `#projekt`. Sie erscheinen in der Filterliste.
- Die Suche berücksichtigt alle Wörter im Titel, im Text und in den Schlagwörtern.
- Schnellnotiz: Strg+Alt+N öffnet ein kleines Fenster, Strg+Enter speichert. Die Tastenkombination gilt, solange die App läuft, und lässt sich in den Einstellungen abschalten.

### Duplikate finden

1. Ordner wählen und „Ordner durchsuchen“ anklicken.
2. Gleiche Dateien werden in Gruppen angezeigt. Gleich heißt: gleicher Inhalt, egal wie die Datei heißt.
3. Mit „Alle außer der ersten Datei markieren“ werden alle Kopien markiert. Sie können auch einzeln markieren.
4. „Markierte in den Papierkorb“ verschiebt die markierten Dateien in den Papierkorb, nach Bestätigung.

### Systemmonitor

Zeigt Prozessor, Arbeitsspeicher, Akku und Datenträger. Die Werte aktualisieren sich jede Sekunde.

### Text ersetzen

1. Ordner wählen, Suchtext und Ersatztext eingeben.
2. Optionen: Groß- und Kleinschreibung, nur ganze Wörter, Originale sichern.
3. „Vorschau erstellen“ zeigt die betroffenen Dateien und die Anzahl der Treffer.
4. „Ersetzen“ schreibt die Änderungen. Mit „Letzten Lauf rückgängig machen“ werden die gesicherten Originale zurückgeschrieben.

Nur Textdateien werden bearbeitet, zum Beispiel `.txt`, `.md`, `.csv`, `.json`, `.html`. Binärdateien werden übersprungen. Die Liste der Dateitypen lässt sich anpassen.

### Erinnerungen

- Einmalig (Datum und Uhrzeit), alle X Minuten, oder täglich zu einer Uhrzeit.
- Erinnerungen erscheinen als Windows-Benachrichtigung. Ist kein Symbol im Infobereich aktiv, erscheint stattdessen ein kleines Hinweisfenster.
- Die App muss laufen, damit Erinnerungen ausgelöst werden. Mit „Mit Windows starten“ und aktiviertem Infobereich-Symbol startet die App im Hintergrund.

### Aufgaben

- Titel eingeben und Enter drücken. Optional ein Fälligkeitsdatum setzen.
- Mit „Erinnerung am Fälligkeitstag“ wird am Fälligkeitstag um 09:00 Uhr eine Erinnerung angelegt.
- Ein Doppelklick oder „Bearbeiten“ ändert Titel und Datum. Das Häkchen markiert eine Aufgabe als erledigt.

### Speicherplatz

Ordner wählen und „Speicherplatz messen“ anklicken. Unterordner werden nach Größe sortiert, mit dem Anteil am Gesamtwert. Symbolische Links werden nicht verfolgt.

### Zeiterfassung

- Projekt und Aufgabe eingeben, dann „Starten“. „Stoppen“ beendet den Timer. Ein neuer Start beendet einen laufenden Timer automatisch.
- Die Liste zeigt die Einträge von heute, darunter die Summen der Woche nach Projekt.
- „Woche als CSV exportieren“ speichert eine Datei mit Semikolon als Trennzeichen. Sie lässt sich in Excel öffnen.

### Zwischenablage-Verlauf

- Standardmäßig ist die Aufzeichnung **aus**. Sie lässt sich unter „Verlauf aufzeichnen“ einschalten oder pausieren.
- Text wird nur auf diesem Gerät gespeichert. Passwort-Manager markieren ihre Kopien als privat; solche Kopien werden nicht gespeichert.
- Doppelklick oder „Kopieren“ legt einen Eintrag wieder in die Zwischenablage.
- „Anheften“ schützt einen Eintrag vor dem Löschen. „Verlauf leeren“ entfernt alle nicht angehefteten Einträge.

## Einstellungen

- **Sprache:** Deutsch oder English. Die Änderung wirkt nach dem nächsten Start.
- **Darstellung:** wie Windows, hell oder dunkel.
- **Mit Windows starten:** startet die App im Infobereich, wenn Windows hochfährt. Standardmäßig aus.
- **Infobereich-Symbol:** mit Menü „Öffnen“ und „Beenden“. Das Schließen des Fensters beendet die App dann nicht.
- **Daten exportieren:** speichert Datenbank und Einstellungen als ZIP-Datei.
- **Alle Daten löschen:** entfernt Notizen, Aufgaben, Erinnerungen, Zeiteinträge, Zwischenablage, Einstellungen, Protokolle und Sicherungen im Datenordner. Backups in Ihren Zielordnern bleiben erhalten. Die App wird danach beendet.

## Probleme

- **Die App startet nicht:** Die Meldung nennt den Protokollordner. Die Datei `desktop-organizer.log` enthält Details.
- **Windows zeigt eine Warnung („Der Computer wurde durch Windows geschützt“):** Die `.exe` ist nicht signiert. Klicken Sie auf „Weitere Informationen“ und danach auf „Trotzdem ausführen“, wenn Sie die Datei aus einer vertrauenswürdigen Quelle haben. Prüfen Sie die Prüfsumme (SHA-256 steht in der Datei `DesktopOrganizer.exe.sha256` der Release-Seite).
- **Ein Ordner wird abgelehnt:** Systemordner wie Windows, Program Files oder fremde Benutzerprofile sind gesperrt.

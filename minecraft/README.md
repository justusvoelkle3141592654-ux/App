# Minecraft-Nachbau (Browser, 1.12-Stil)

Fan-Nachbau, nicht von Mojang/Microsoft. Alle Texturen werden prozedural im Code gezeichnet (keine Originaldateien).

## Starten
```bash
cd minecraft && ./start.sh      # dann http://localhost:8000 öffnen
```
Testen ohne Menü: `index.html?autostart=1&seed=1&mode=creative&dim=overworld|nether|end&nolock=1`

## Steuerung
WASD, Leertaste (Springen / Creative: Doppeltipp = Fliegen), Shift (Schleichen), Strg (Sprinten), linke Maustaste (Abbauen/Angreifen), rechte Maustaste (Platzieren/Benutzen/Essen), 1–9 / Mausrad (Hotbar), E (Inventar), Q (Droppen), T oder / (Konsole), F3 (Debug), Esc (Pause).

## Befehle
`/gamemode survival|creative`, `/tp x y z`, `/time set day|night|<n>`, `/give <name|id> [n]`, `/dimension overworld|nether|end`, `/summon <mob>`, `/locate stronghold`, `/seed`, `/kill`, `/help`

## Struktur
`SPEC.md` (Modulvertrag), `js/registry.js` (Blöcke/Items), `world.js`/`worldgen.js` (Welt), `render.js`/`mesher.js` (Rendering), `ui.js`/`inventory.js`/`recipes.js` (GUI), `player.js`/`main.js` (Spiel), `entities.js`/`mobs.js` (Mobs, Enderdrache).

## Bekannte Lücken
Kein Speichern/Laden; keine Dörfer/Schluchten; Stronghold ist ein einzelner Raum; Ghast und Magma Cube fehlen; Enderdrache ohne Blockzerstörung/Atem; Fackeln nur aufrecht; Ton nur synthetisch und ungehört getestet; 4-s-Wartezeit im Nether-Portal und Truhe/Ofen-Screens nicht Ende-zu-Ende getestet.

## Handy
- `dist/minecraft.html`: einzelne Datei mit allem eingebettet (Touch-Steuerung inklusive), im Handy-Browser öffnen.
- `dist/minecraft.apk`: Android-App (WebView, Vollbild, Querformat), mit Debug-Schlüssel signiert, Android 7.0+. Installation: "Unbekannte Apps installieren" erlauben.
- Touch: linker Daumen = Laufen (Stick), rechter Daumen wischen = Umsehen, kurzes Tippen = Schlag, lang drücken = Abbauen. Buttons: HIT, USE (Platzieren/Benutzen), JUMP, SNK (Schleichen), RUN, INV, CMD, II (Pause), < > (Hotbar).

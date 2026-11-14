# Minecraft-Nachbau (Vanilla ~1.12-Stil) — Modulvertrag

Reine Browser-App: ES-Module, three.js (vendored `lib/three.module.js`, r160), KEIN Build-Schritt.
Start: `cd minecraft && python3 -m http.server 8000` → http://localhost:8000
`index.html` hat eine importmap: `"three": "./lib/three.module.js"` → in allen Modulen `import * as THREE from 'three'`.
Alle Module liegen in `js/`. `js/registry.js` (Blöcke/Items) ist FERTIG und darf NICHT geändert werden (nur lesen!).

Konventionen: 1 Block = 1 Einheit. Block (x,y,z) belegt [x,x+1)×[y,y+1)×[z,z+1). Y nach oben. Welthöhe HEIGHT=128, Chunk 16×16.
Blockindex im Chunk: `(y*16 + z)*16 + x` (x,z lokal 0..15). Flächenreihenfolge überall: 0:+x 1:-x 2:+y 3:-y 4:+z 5:-z.
Texturen: 16×16 px, `NearestFilter`, KEINE Mipmaps (pixelig wie echtes Minecraft). Keine Mojang-Originaldateien verwenden:
alle Texturen werden prozedural per Canvas im Stil von Vanilla 1.12 gezeichnet (Farbpaletten/Muster dem Original nachempfunden).
Sprache der Texte im Spiel: Englisch (wie Vanilla), Namen kommen aus registry.js.

## Module & Besitzer (jeder Agent schreibt NUR seine Dateien)

### textures.js (Agent TEX)
```
export function buildBlockAtlas() -> { canvas, texture /*THREE.CanvasTexture*/, size /*tiles per row*/, tile:16,
                                       uv(name) -> [u0,v0,u1,v1] /* v up (three.js convention, flipY=true texture) */, names }
export function buildItemAtlas()  -> same shape for allItemTiles() (+ all block sprite tiles)
export function drawItemIcon(ctx, itemId, x, y, size) // GUI icon: block items = isometric cube (top/left/right faces with shading) , flat-sprite blocks (torch, flowers, tallgrass, ...) & items = their 16x16 sprite scaled with imageSmoothingEnabled=false
export function getTileCanvas(name) -> HTMLCanvasElement 16x16 (blocks or items)
export function animatedTiles // optional: {water,lava,portal,fire} frames update: export function tickTextures(t) updates animated tiles in the atlas canvas (water/lava/portal/fire/end_portal) and sets texture.needsUpdate (call ~10x/s)
```
Muss ALLE Namen aus `allBlockTiles()` und `allItemTiles()` (registry.js) liefern. Stil: wie Vanilla 1.12 (grass_side mit grünem Rand, stone grau mit Rauschen, ores mit Punkten, planks mit Maserung, logs mit Ringen, leaves dunkelgrün mit Löchern (alpha), cobblestone, bricks, etc.).
Wasser: halbtransparent blau, Lava orange/gelb mit Rauschen, Portal violett, End-Portal schwarz mit Sternen.

### world.js (Agent WORLD)
```
export const HEIGHT=128, SEA=62;
export class World {
  constructor(seed:number, dim:'overworld'|'nether'|'end')
  chunks: Map<string,Chunk>   // key `${cx},${cz}`
  getBlock(x,y,z)->id (0 außerhalb), getMeta(x,y,z), setBlock(x,y,z,id,meta=0,{silent})  // markiert Chunk + betroffene Nachbarchunks dirty, aktualisiert Licht, ruft Listener
  getSky(x,y,z)->0..15, getBlockLight(x,y,z)->0..15   // Licht (Flood-Fill; Himmelslicht von oben, Fackeln/Lava/Glowstone etc. aus registry `light`)
  ensureChunk(cx,cz)->Chunk (generiert falls nötig)
  getChunk(cx,cz)->Chunk|undefined
  heightAt(x,z)->y der obersten soliden Blockoberfläche+1
  raycast(ox,oy,oz,dx,dy,dz,maxDist,{liquids:false})->{x,y,z,face:[nx,ny,nz],id}|null   // Voxel-DDA, ignoriert Luft (und Flüssigkeiten außer liquids:true), trifft auch nicht-solide Blöcke wie Fackeln/Gras
  findSpawn()->{x,y,z}
  tick(dt, px, pz)  // Zufalls-/Fluid-Ticks nahe dem Spieler: Wasser/Lava fließen (Quellen+Level in meta 0..7), Sand/Kies fallen, Gras breitet sich aus/verdorrt, Feuer brennt aus/breitet sich auf flammable aus, Blätter zerfallen, TNT optional
  onChange(fn(x,y,z,oldId,newId))   // Listener (Mesher/Mobs)
  blocksAABB helpers: isSolid(x,y,z), isLiquid(x,y,z)
  saveData()/loadData(obj) // geänderte Blöcke (Diff-Map) für Dimension wechseln & Weiterspielen. Optional einfache Variante genügt.
}
export class Chunk { cx, cz, blocks:Uint8Array(16*128*16), meta:Uint8Array(same), sky:Uint8Array, blk:Uint8Array, dirty:boolean, version:number, mesh:any /*vom Renderer gesetzt*/ }
export function tryLightNetherPortal(world,x,y,z)->bool  // Feuer auf Obsidian: prüft Rahmen (innen 2..21 breit, 3..21 hoch, Obsidian-Rand), füllt innen mit B.NETHER_PORTAL (meta 0=Achse x,1=Achse z)
export function findOrCreatePortal(world,x,y,z)->{x,y,z}  // im Zieldimension: vorhandenes Portal suchen (Radius ~32) sonst Obsidianrahmen+Plattform bauen
export function tryInsertEye(world,x,y,z)->bool  // Auge in END_PORTAL_FRAME (meta|=4); sind alle 12 Rahmen gefüllt → 3x3 B.END_PORTAL
```
Generatoren (ein Chunk = <15 ms!): 
- **Overworld**: Value/Simplex-Noise (eigene Implementierung, seeded), Biome (Ebene, Wald, Wüste, Taiga/Schnee, Berge/Hills, Ozean/Strand, evtl. Sumpf optional) über Temperatur/Feuchte-Noise, Terrain 3D-Höhenvariation, Wasser bis SEA, Strände (Sand), Bedrock-Schicht y=0 (zufällig bis y=4), Höhlen (3D-Noise Würmer/Spaghetti), Schluchten optional, Erze mit vanilla-Verteilung (Kohle, Eisen, Gold tief, Redstone tief, Diamant y<16, Lava-Seen unter y=11), Bäume (Eiche, Birke, Fichte, Kaktus in Wüste), Gras, Blumen, Schnee. Kleine Dörfer optional (nicht Priorität). **Stronghold**: genau eine unterirdische Steinziegel-Kammer mit End-Portal-Rahmen (12 Rahmen, `meta` ohne Auge, Lava darunter) bei ca. Entfernung 150–250 Blöcke vom Ursprung, y≈30; Koordinaten über `export const STRONGHOLD = {x,y,z}` verfügbar (Seed-deterministisch) .
- **Nether**: Decke+Boden Bedrock, Netherrack, Lava-Meer bei y<32, Höhlenartige 3D-Noise-Hohlräume, Glowstone-Cluster an Decke, Quarzerz, Soul-Sand-Flecken, Feuer vereinzelt, Netherziegel-Festung (kleine Strukturen optional).
- **End**: Hauptinsel aus End Stone (Radius ~45 um (0,64,0)), 10 Obsidiansäulen im Kreis (Radius 40, unterschiedliche Höhe 76–103), oben Bedrock-Basis mit Feuer (Kristalle erzeugt mobs.js über `export const END_PILLARS = [{x,y,z,h}]`), Exit-Portal-Brunnen in der Mitte (B.BEDROCK_END_EXIT, Portal wird nach Drachentod gefüllt durch Game). Leere (Void) darum, y<0 = Fall in den Tod.
Chunk-Gen darf deterministisch aus Seed+cx,cz erfolgen, Bäume/Strukturen über Chunkgrenzen via Positions-Hash.

### render.js (Agent RENDER)
```
export class Renderer {
  constructor(canvas, atlasBlock, atlasItem)          // erzeugt THREE.WebGLRenderer, Scene, Camera (FOV 70, near .05 far ~ renderDistance*16), Antialias off
  setWorld(world)                                     // wechselt Dimension: Meshes entfernen, Himmel/Nebel/Lichtstimmung anpassen (overworld: Tageszeit/Himmel/Sonne/Mond/Sterne/Wolken; nether: rotbrauner Nebel, kein Himmel; end: dunkler Himmel mit lila Nebel)
  renderDistance: number (Chunks, default 6; Einstellung 2..12)
  update(dt, player:{pos:THREE.Vector3(eye), yaw, pitch}, timeOfDay /*0..24000*/)   // Chunks nahe Spieler ensure+meshen (max ~2 Mesh-Rebuilds/Frame, nächste zuerst), Kamera setzen, Himmelsfarbe nach Tageszeit, Tag/Nacht-Helligkeit (sky light × Tageslichtfaktor), Nebel
  render()
  setSelection(blockOrNull /*{x,y,z,id}*/)            // schwarzer Linien-Rahmen (wie Vanilla), passt sich Blockform an
  setBreakProgress(blockOrNull, 0..1)                 // 10 Crack-Stufen (destroy_stage_0..9, prozedural gezeichnet) als Overlay
  addParticles(kind:'break'|'smoke'|'flame'|'portal'|'splash'|'explosion', x,y,z, blockId?, count?)  // Partikel mit Block-Textur-Splittern
  setHeldItem(itemId|0, swingT /*0..1*/, bobT)         // 3D-Item in der rechten unteren Ecke wie Vanilla (Block = kleiner Würfel, Item/Werkzeug = extrudierter 16x16 Sprite), Schwung beim Schlagen/Abbauen; Hand wenn leer (Arm-Box in Steve-Hautfarbe)
  setUnderwater(bool), setDamageFlash(0..1), setFov(deg)
  scene: THREE.Scene, camera: THREE.PerspectiveCamera   // von mobs.js zum Hinzufügen von Meshes genutzt
  worldToScreen? nicht nötig
}
```
Mesher: Greedy nicht nötig; pro Chunk (16×16×128) ein Mesh für opake + eines für alpha-test (Blätter, Glas, Kreuz-Pflanzen) + eines für Wasser/Portal (transparent). Faces nur an sichtbaren Kanten; **Vertex-Farben** = (sky*dayFactor ⊕ blocklight) Helligkeitskurve 0.8^(15-l) mit Mindesthelligkeit + weiches AO (0..3 Stufen) + Vanilla-Seitenshading (top 1.0, bottom 0.5, x-Seiten 0.6, z-Seiten 0.8). Wasseroberfläche 14/16 hoch, Lava 14/16, Fackel (dünner Quader/geneigt vereinfachen erlaubt), Kaktus 1px eingerückt, Kreuz-Pflanzen als 2 diagonale Quads, Portal als dünne Fläche, Feuer als Kreuz+Seiten, Frame 13/16 hoch (meta&4 → Auge als kleiner Block oben), Truhe 14/16. Beleuchtungsänderung bei Tageszeit: Material-Farbmultiplikator/uniform (nicht neu meshen!).
Chunk-Mesh neu bauen wenn `chunk.dirty` (nach Reset auf false). Unload weit entfernter Chunks (World darf Chunks halten, Renderer entsorgt Geometrie).

### inventory.js + recipes.js (Agent UI)
```
// inventory.js
export class ItemStack { constructor(id,count=1,damage=0) }  // damage = verbrauchte Haltbarkeit
export class Inventory {
  slots: (ItemStack|null)[]  // 0..8 Hotbar, 9..35 Hauptinventar, 36..39 Rüstung (36 Helm,37 Brust,38 Hosen,39 Schuhe), 40 Offhand ignorieren
  selected: number
  add(id,count=1,damage=0)->rest  // stackt zuerst, dann leere Slots (Hotbar zuerst)
  getSelected()->ItemStack|null, consumeSelected(n=1), damageSelected(amount=1)
  armorPoints()->number
  has(id,count), clear()
}
// recipes.js
export function matchCraft(grid:(ItemStack|null)[], w:number)->{id,count}|null  // 2x2 oder 3x3, shaped (inkl. Spiegelung) + shapeless
export const SMELTING: Map<inputId,{out,xp}>, FUEL: Map<itemId,burnSeconds>
export const RECIPES // Liste: Planks aus Log (alle 3 Holzarten -> B.PLANKS), Sticks, Crafting Table, Furnace, Chest, Torch (coal/charcoal+stick), alle Werkzeuge (wood/stone[cobble]/iron/gold/diamond), Rüstung, Bucket, Flint&Steel, Bow, Arrow, Bricks?, Eye of Ender (ender_pearl+blaze_powder), Blaze Powder (blaze rod), Block-Kompressionen (iron/gold/diamond/coal block + zurück), Stone Bricks, Sandstone, Wool? (string x4), TNT (gunpowder+sand), Glowstone (4 dust), Bread (3 wheat) usw.
SMELTING: Iron Ore->Iron Ingot, Gold Ore->Gold Ingot, Sand->Glass, Cobble->Stone, Log->Charcoal, Raw Beef->Steak, Raw Porkchop->Cooked, Clay->Brick block optional, Netherrack optional
```

### ui.js (Agent UI)  — DOM/CSS + <canvas> Icons (image-rendering: pixelated), GUI-Skalierung wie Vanilla (Faktor 2–3 abhängig von Fenstergröße)
```
export class UI {
  constructor(root:HTMLElement, game /*duck-typed: {player, inventory, world, settings, ...}*/, textures /*{drawItemIcon,getTileCanvas}*/)
  // HUD
  update(dt)  // zeichnet Hotbar (182×22 Vanilla-Optik, Rahmen dunkelgrau/hell, Auswahlrahmen weiß 24×24), Herzen (10, halbe, rot, Blink), Hunger-Keulen (10), Rüstungsleiste (Symbole oben links der Herzen), Luftblasen unter Wasser, XP-Leiste + Level, Fadenkreuz (Vanilla-Kreuz weiß/invertiert), Item-Name Einblendung beim Slotwechsel, Haltbarkeitsbalken auf Items, Stackzahl rechts unten (weiß mit dunklem Schatten)
  showChat(text) / toast  // Kommandoausgabe
  openInventory() / openCrafting() / openFurnace(pos) / openChest(pos) / closeScreen()  // Vanilla-Optik: graue Panels (#c6c6c6 mit hell/dunkel-Rand 3D-Bevel), Slots dunkel (#8b8b8b mit Bevel), Rüstungsslots + Spielermodell-Vorschau, Crafting 2×2/3×3 + Ergebnisslot, Drag&Drop wie Vanilla (Linksklick Stack aufnehmen/ablegen, Rechtsklick Hälfte/Einzelnes, Shift-Klick schnell verschieben, Doppelklick sammeln, Zahlentasten→Hotbar), Tooltip mit Itemname (dunkelvioletter Rahmen), Creative: durchsuchbares Item-Menü (Creative-Inventar mit allen Items, Tabs optional)
  openMainMenu(onPlay) // Titelbild: "MINECRAFT"-Logo als Blockbuchstaben aus Canvas (dicke grau-steinige Blockbuchstaben mit dunkler Kante, ähnlich Vanilla-Logo, aber selbst gezeichnet) , gelber Splash-Text, Buttons ("Singleplayer", "Options" mit Renderdistanz/FOV/Maus-Empfindlichkeit, "Quit" → Pause), Hintergrund: Dirt-Textur gekachelt abgedunkelt (wie Vanilla "options background") oder rotierender Panorama-Platzhalter
  openPause(onResume, onOptions) // "Game Menu" Buttons (Back to Game, Options..., Save and Quit to Title)
  openDeath(onRespawn) // roter Overlay "You died!" + Score, Respawn-Button
  debug(lines:string[]) // F3-Overlay (links oben, weiße Schrift mit Schatten)
  isOpen() -> bool (irgendein GUI offen → Spiel liest keine Bewegungseingaben)
  Furnace-Logik: Smelting-Tick (Brennstoff, Fortschrittspfeil, Flamme) für platzierte Öfen pro Position gespeichert (Map "x,y,z" -> {input,fuel,output,burn,cook}), tickFurnaces(dt) vom Game aufgerufen
  Chest-Inhalt pro Position (27 Slots, Map)
}
Schrift: Vanilla-Optik via Monospace-Pixelschrift: CSS font-family `"Minecraft", "Courier New", monospace` mit selbst eingebettetem Pixel-Font ist NICHT nötig; aber Text soll fett, weiß, mit dunklem Schatten (1px*Skalierung, #3f3f3f) dargestellt werden. Optional einfachen 5x7-Bitmap-Font selbst in Canvas zeichnen (besser!).
```

### player.js + main.js + commands (Agent GAME)
- `player.js`: `Player` mit Position (Füße), Geschwindigkeit, AABB 0.6×1.8, Augenhöhe 1.62, vanilla-Physik (Gravitation 0.08/tick → in m/s²: 32, Sprung 0.42/tick → ~9 m/s, Lauf 4.317 m/s, Sprint 5.612, Schleichen 1.3 (kein Abfallen an Kanten), Fliegen im Creative (Doppeltap Space, 10.9 m/s), Schwimmen, Leitern nicht nötig, Lava-Schaden+Brennen, Sturzschaden (ab >3 Blöcken), Ertrinken (15 s Luft), Hunger-System (Sprint/Heilen/Regeneration bei Hunger≥18, Verhungern), Gesundheit 20, Respawn am Spawn, Rüstungsreduktion, Knockback, Kollision Achse für Achse, Step-up nicht (nur Springen)).
- `main.js`: Spielschleife (feste Physikticks 20 Hz oder dt-basiert), Pointer-Lock-Maus, WASD, Space, Shift, Ctrl-Sprint, 1–9/Mausrad, E Inventar, Esc Pause, F3 Debug, F5 optional, T/`/` Konsole, Q Item droppen. Block abbauen (linke Maustaste halten, `breakTime` aus registry, Rissanimation, Drops als Item-Entity via `entities.addItem`, Werkzeug-Haltbarkeit), Block setzen (rechte Taste: Block platzieren, nicht im Spieler; Interaktion: Crafting Table/Furnace/Chest öffnet UI; Bucket Wasser/Lava, Flint&Steel → Feuer/Portal `tryLightNetherPortal`, Essen halten (Nahrung), Ender Eye → `tryInsertEye` am Frame, sonst Eye wirft sich Richtung STRONGHOLD (optional), Ender Pearl teleportiert, Bogen schießt Pfeile), Angriff auf Mobs (Raycast gegen Entity-AABBs, Schaden nach Waffe, Cooldown optional, kritische Treffer beim Fallen), Dimension wechseln: im NETHER_PORTAL 4 s stehen → Nether (Koordinaten /8), `findOrCreatePortal`; END_PORTAL berühren → End (Spawn auf Plattform (100,49,0) wie Vanilla = bei uns Position (0,..) nahe Insel mit Obsidianplattform), im End Exit-Portal berühren → Overworld-Spawn/Bett. Tageszeit (24000 Ticks = 20 min), Tag/Nacht-Zyklus, Mob-Spawn-Regeln via mobs.js. Gamemodes: survival/creative (/gamemode). Konsole (Taste T oder /) Befehle: `/gamemode survival|creative`, `/tp x y z`, `/time set day|night|<n>`, `/give <itemname|id> [n]`, `/dimension overworld|nether|end`, `/seed`, `/kill`, `/summon <mob>`, `/locate stronghold`. Einstellungen: renderDistance, FOV, Mausempfindlichkeit, Lautstärke (WebAudio-Sounds optional via kleine synthetische Sounds: Schritte/Abbauen/Platzieren/Treffer/Explosion — eigener Mini-Synth in `audio.js`).
- Respawn/Tod: Inventar fällt (Item-Entities) im Survival, `ui.openDeath`.

### entities.js + mobs.js (Agent MOBS)
```
// entities.js
export class EntityManager {
  constructor(game /*{world, renderer, player, ui, inventory}*/)
  update(dt)           // alle Entities updaten (Physik gegen World, Kollision), Items einsammeln (Pickup-Radius 1.0, Magnet-Animation), Despawn
  addItem(id,count,x,y,z,vel?) // Item-Entity: kleines rotierendes/schwebendes 3D-Item (Block = Mini-Würfel, Item = extrudierter Sprite), 5 min Lebensdauer, stacks mergen
  spawnMob(type,x,y,z)->Mob, mobs:[], raycastEntity(ox,oy,oz,dx,dy,dz,max)->{entity,dist}|null
  damageMob(mob,amount,knockbackDir) , explode(x,y,z,power,{fire:false}) // TNT/Creeper/Kristalle: Blöcke zerstören (Drops 30%), Spieler Schaden, Partikel
  shootArrow(...), tickSpawning(dt, dim, timeOfDay) // Mob-Spawning in Dunkelheit (Zombie, Skeleton, Creeper, Spider; nachts Oberfläche, in Höhlen immer bei Licht<=7), passive Mobs bei Tag auf Gras (Pig, Cow, Sheep, Chicken), Nether: Zombie Pigman, Blaze (Feuerbälle), Ghast (optional), Magma Cube optional; End: Enderman
  setDimension(dim) // löscht Mobs, End: spawnt Ender Dragon + 10 Kristalle
}
```
Mob-Modelle: aus Boxen (THREE.BoxGeometry) mit pro-Fläche Canvas-Texturen im Vanilla-Stil (Zombie grün, Skeleton, Creeper (grünes Pixelmuster+Gesicht), Pig rosa, Cow, Sheep, Chicken, Spider, Enderman schwarz mit lila Augen, Zombie Pigman, Blaze, Ender Dragon (groß, Flügelflattern, schwarz/violett) und Ender-Kristalle (rotierend, Beam zum Drachen). Animation: Beinschwung, Kopfdrehung zum Spieler, Hurt-Flash (rot), Todesanimation (umkippen), Loot (Rotten Flesh, Bones, Arrows, Gunpowder, String, Beef, Pork, Leather, Feather, Blaze Rod, Ender Pearl (Enderman), Apple?), XP. AI: Zombies verfolgen+schlagen (Schaden 3 normal), Skeletons schießen Pfeile, Creeper zischen+explodieren (Fuse 1.5 s), Spinne klettert nicht nötig, Enderman teleportiert wenn angeschaut/getroffen, Pigman neutral, Blaze schießt 3 Feuerbälle, Ender Dragon: kreist, stürzt auf Spieler, Kristalle heilen; Tod → Exit-Portal füllt sich (`game.onDragonDead()`), XP-Regen, Dragon Egg (B.DRAGON_EGG) auf Portal. Sonnenlicht: Zombies/Skeletons brennen am Tag.

## Game-Objekt (von main.js gebaut und an alle gereicht)
`game = { world, renderer, entities, ui, player, inventory, settings:{renderDistance,fov,sensitivity,volume}, dimension, time, gamemode, textures, audio, onDragonDead(), setDimension(dim,pos) }`
Jedes Modul darf nur die oben gelisteten APIs der anderen aufrufen (für Dinge, die nicht in der Spec stehen: selbst im eigenen Modul lösen oder defensiv `?.` benutzen).

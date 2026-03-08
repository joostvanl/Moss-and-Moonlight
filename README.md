# Moss & Moonlight

A **Phaser 3 enchanted-forest platformer** — no build step, no external assets. Everything is procedurally drawn with the Phaser Graphics API.

Play as a glowing forest spirit collecting fireflies through five increasingly difficult moonlit worlds.

---

## Play

**[http://localhost:53815](http://localhost:53815)** *(after starting a local server — see below)*

### Controls

| Key | Action |
|---|---|
| ← → or A D | Move |
| ↑ or W (tap) | Low jump |
| ↑ or W (hold) | High jump |
| R | Restart from level 1 |

Mobile touch buttons (← → ↑) are shown automatically on touch devices.

### Goal

Collect all **fireflies** in a level to advance to the next. You have 3 lives — lose them all and it's game over.

---

## Enemies

| Type | Description |
|---|---|
| **Ground enemy** | Patrols a fixed range; jump on top to defeat |
| **Flyer** | Flying bat that hovers and shoots homing projectiles |
| **Counter** | Bomb that chases you; explodes after 5 proximity ticks |

Touching an enemy from the side or below costs a life. Bullets also cost a life on contact.

---

## Powerups

| Icon | Effect | Duration |
|---|---|---|
| 🔵 Blue | Double jump | 10 s |
| 🟠 Orange | Speed boost | 10 s |
| ❤️ Red | Extra life | Instant |

---

## Levels

| # | Name | New elements |
|---|---|---|
| 1 | Maanwoud | Ground enemies, intro |
| 2 | Kristalgrotten | Flyers with projectiles |
| 3 | Schaduwrijk | Faster enemies, more Flyers |
| 4 | De Krochten | Counter bombs |
| 5 | De Vuurgrot | Lava pits, maximum difficulty, hidden shovel easter egg |

---

## Modifiers

After completing each level a **modifier picker** appears — choose one of three random cards. The modifier stays active for the rest of the run.

| ID | Category | Effect |
|---|---|---|
| `fast_enemies` | Harder | Enemies move 40% faster |
| `slow_enemies` | Easier | Enemies move 40% slower |
| `extra_life` | Easier | +1 life |
| `reduced_jump` | Harder | Jump height −20% |
| `high_jump` | Easier | Jump height +25% |
| `speed_run` | Twist | 90-second time limit per level |
| `slippery_ground` | Twist | Reduced ground friction |

Modifier definitions live in `modifiers.json`.

---

## Admin Panel

Click **⚙ Admin** (top-right) in-game to open the admin panel:

- Jump directly to any level
- Skip the current level
- Restore all lives to 3

---

## Internationalisation

The game supports **11 languages** switchable at runtime via the top-left dropdown. The active language is saved to `localStorage`.

Supported: 🇳🇱 Nederlands · 🇬🇧 English · 🇩🇪 Deutsch · 🇫🇷 Français · 🇪🇸 Español · 🇧🇷 Português · 🇨🇳 中文 · 🇮🇳 हिन्दी · 🇸🇦 العربية · 🇯🇵 日本語 · 🇷🇺 Русский

All strings live in `i18n.json`.

---

## Level Editor

Open `/editor.html` or click **✏ Open Level Editor** in the admin panel.

### Tools

| Tool | What it does |
|---|---|
| ＋ Platform | Place a moss / log / mushroom platform; drag to move |
| ✦ Firefly | Place a collectible firefly |
| ◈ Powerup | Place a double-jump / speed / heart powerup |
| 👾 Enemy | Place a ground-patrolling enemy |
| 🦇 Flyer | Place a flying shooting enemy |
| 🔮 Counter | Place a chasing bomb enemy |
| 🌋 Lava | Click-drag horizontally to draw a lava pit section |
| ✕ Delete | Click any object to remove it |

### Keyboard shortcuts

| Key | Action |
|---|---|
| G | Toggle grid snapping |
| ← → or A D | Scroll the camera |

### Saving

Click **💾 Save to game** — changes are written to `localStorage` under key `mm_level_<index>` and picked up immediately the next time the game loads. Click **↺ Reset** to discard all editor changes for a level.

---

## Running Locally

```bash
# Node.js (recommended)
npx serve

# Python 3
python -m http.server 8000
```

Then open `http://localhost:<port>` in your browser.

---

## File Structure

```
index.html       — game shell (language selector, admin panel, touch controls)
editor.html      — level editor shell
js/
  game.js        — all game logic (GameScene, UIScene, ModifierScene)
  editor.js      — all editor logic (EditorScene + sidebar wiring)
levels.json      — level definitions (platforms, enemies, fireflies, lava, …)
i18n.json        — UI strings for all 11 languages
modifiers.json   — modifier card definitions
```

---

## Technology

- **[Phaser 3](https://phaser.io/)** v3.70.0 via CDN — zero build step
- Arcade Physics
- All visuals procedurally generated — no external image assets
- Level data fully data-driven via `levels.json` — editable without touching code
- Editor saves to `localStorage`; game reads overrides on startup

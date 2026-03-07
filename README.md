# Moss & Moonlight

Een Phaser 3 platform game met het thema **betoverd bos bij maanlicht**.

## Spelen

Je speelt als een **bosgeest** (groen gloeiend wezen) die door een mystiek woud springt.  
Verzamel **vuurvliegjes** om een level te voltooien. Vermijd of verslaan vijanden door er bovenop te springen.

### Besturing

| Toets | Actie |
|---|---|
| ← → | Bewegen |
| ↑ (kort) | Laag springen |
| ↑ (lang) | Hoog springen |
| R | Opnieuw beginnen |

### Powerups

| Kleur | Effect |
|---|---|
| 🔵 Blauw | Dubbele sprong (10 s) |
| 🟠 Oranje | Snelheidsboost (10 s) |
| ❤️ Rood | Extra leven |

## Levels

| # | Naam | Thema |
|---|---|---|
| 1 | Maanwoud | Rustig bos, introductie |
| 2 | Kristalgrotten | Kristallen grotten, vliegende vijanden |
| 3 | Schaduwrijk | Donker woud, snellere vijanden |
| 4 | De Krochten | Leegte, Counter-wezens |
| 5 | De Vuurgrot | Vulkanische grotten, maximale moeilijkheid |

## Lokaal draaien

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve
```

Open daarna `http://localhost:8000` in je browser.

## Editor

Ga naar `/editor.html` voor de ingebouwde level editor.  
Gebruik de knop **← Spel** of het admin paneel (⚙ Admin) om te wisselen tussen spel en editor.

## Technologie

- **Phaser 3** (v3.70.0) via CDN — geen build stap nodig
- Arcade Physics
- Levels in `levels.json` — aanpasbaar zonder code
- Geen externe assets — alles procedureel gegenereerd met Phaser Graphics API

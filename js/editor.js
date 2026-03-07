/**
 * Moss & Moonlight — Level Editor
 * Standalone Phaser scene for visual level editing.
 * Saves to localStorage key "mm_level_<index>" which game.js reads on startup.
 */

// ─── Editor state ─────────────────────────────────────────────────────────────

const EditorState = {
  currentLevel: 0,
  tool: 'place-platform',   // 'place-platform' | 'place-firefly' | 'place-powerup' | 'place-enemy' | 'place-flyer' | 'delete'
  gridEnabled: true,
  gridSize: 8,
  selectedObj: null,        // { category, index }

  // Working copies of level arrays (mutated by editor, saved on demand)
  platforms: [],
  spikes: [],
  fireflies: [],
  powerups: [],
  enemies: [],
  flyingEnemies: [],
  counters: [],

  // New-object settings from sidebar
  newPlat: { type: 'moss', w: 160, h: 22 },
  newPuType: 'double_jump',
  newEnemy: { patrolW: 160, speed: 55 },
  newFlyer: { patrolW: 300, speed: 60, shootInterval: 8000 },
  newCounter: { chaseSpeed: 28, proximityR: 110, tickInterval: 333 },
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function snapToGrid(v, grid) {
  return EditorState.gridEnabled ? Math.round(v / grid) * grid : v;
}

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

function setStatus(msg) {
  const el = document.getElementById('status-bar');
  if (el) el.textContent = msg;
}

// Load working arrays from LEVELS default + any saved override
function loadLevelData(idx) {
  const base = LEVELS[idx];
  const saved = localStorage.getItem('mm_level_' + idx);
  const override = saved ? JSON.parse(saved) : {};

  EditorState.platforms     = deepCopy(override.platforms     ?? base.platforms);
  EditorState.spikes        = deepCopy(override.spikes        ?? base.spikes);
  EditorState.fireflies     = deepCopy(override.fireflies     ?? base.fireflies);
  EditorState.powerups      = deepCopy(override.powerups      ?? base.powerups);
  EditorState.enemies       = deepCopy(override.enemies       ?? base.enemies);
  EditorState.flyingEnemies = deepCopy(override.flyingEnemies ?? base.flyingEnemies ?? []);
  EditorState.counters      = deepCopy(override.counters      ?? base.counters      ?? []);
}

function saveLevelData(idx) {
  const data = {
    platforms:     EditorState.platforms,
    spikes:        EditorState.spikes,
    fireflies:     EditorState.fireflies,
    powerups:      EditorState.powerups,
    enemies:       EditorState.enemies,
    flyingEnemies: EditorState.flyingEnemies,
    counters:      EditorState.counters,
  };
  localStorage.setItem('mm_level_' + idx, JSON.stringify(data));
  setStatus('Opgeslagen! Open index.html om te spelen.');
}

// ─── EditorScene ──────────────────────────────────────────────────────────────

class EditorScene extends Phaser.Scene {
  constructor() {
    super({ key: 'EditorScene' });
  }

  create() {
    this.camX = 0;           // current camera scroll offset
    this.isDragging = false;
    this.dragObj    = null;   // { category, index, offX, offY }
    this.ghostGfx   = null;
    this.overlayGfx = null;
    this.gridGfx    = null;
    this.selGfx     = null;   // selection highlight

    loadLevelData(EditorState.currentLevel);
    this.cameras.main.setBounds(0, 0, WORLD_W, VIEW_H);

    this._buildWorld();
    this._buildOverlay();
    this._buildGrid();
    this._buildSelectionHighlight();
    this._bindInput();

    setStatus('Gereed — klik op canvas om te plaatsen · G = grid · ← → scrollen');
  }

  // ── World rendering ────────────────────────────────────────────────────────

  _buildWorld() {
    // Destroy existing world objects if rebuilding
    if (this._worldContainer) this._worldContainer.destroy();
    this._worldContainer = this.add.container(0, 0);

    const lvl = this._currentLvlTheme();

    // Sky
    const sky = this.add.graphics().setScrollFactor(0);
    sky.fillGradientStyle(lvl.bgTop, lvl.bgTop, lvl.bgBottom, lvl.bgBottom, 1);
    sky.fillRect(0, 0, VIEW_W, VIEW_H);
    this._worldContainer.add(sky);

    // Stars (fixed)
    for (let i = 0; i < 70; i++) {
      const x = (i * 137 + 42) % VIEW_W;
      const y = (i * 97  + 17) % (VIEW_H * 0.68);
      const r = (i % 3 === 0) ? 1.5 : 1;
      const s = this.add.circle(x, y, r, 0xf5f0d8, 0.15 + (i%5)*0.07).setScrollFactor(0);
      this._worldContainer.add(s);
    }

    // Moon
    this.add.circle(VIEW_W - 100, 68, 68, lvl.moonColor, 0.07).setScrollFactor(0);
    this.add.circle(VIEW_W - 100, 68, 44, lvl.moonColor, 0.92).setScrollFactor(0);

    // Parallax trees
    const layerSpeeds = [0.05, 0.12, 0.22];
    const layerHeights = [220, 170, 130];
    lvl.paralaxTrees.forEach((color, li) => {
      const g = this.add.graphics().setScrollFactor(layerSpeeds[li]);
      g.fillStyle(color, 1);
      for (let t = 0; t < Math.ceil(WORLD_W / 80) + 2; t++) {
        const tx = t * 78 + (li * 26);
        const th = layerHeights[li] + ((t * 37 + li * 13) % 60);
        g.fillTriangle(tx, VIEW_H, tx + 36, VIEW_H - th, tx + 72, VIEW_H);
      }
    });

    // Ground
    const g = this.add.graphics();
    g.fillStyle(lvl.groundDirt, 1);
    g.fillRect(0, GROUND_Y + 8, WORLD_W, VIEW_H - GROUND_Y);
    g.fillStyle(lvl.groundFill, 1);
    g.fillRect(0, GROUND_Y + 4, WORLD_W, 12);
    g.fillStyle(lvl.groundTop, 1);
    g.fillRect(0, GROUND_Y, WORLD_W, 8);
    g.fillStyle(lvl.groundTop, 1);
    for (let x = 4; x < WORLD_W; x += 8) {
      const h = 4 + ((x * 7 + 3) % 6);
      g.fillTriangle(x, GROUND_Y, x + 3, GROUND_Y - h, x + 6, GROUND_Y);
    }
    for (let x = 60; x < WORLD_W; x += 160 + ((x * 11) % 80)) {
      const bw = 30 + (x % 40), bh = 18 + (x % 18);
      g.fillStyle(lvl.bushColor, 0.9);
      g.fillEllipse(x, GROUND_Y - bh / 2, bw, bh);
      g.fillEllipse(x + bw * 0.35, GROUND_Y - bh * 0.7, bw * 0.6, bh * 0.7);
      g.fillEllipse(x - bw * 0.3,  GROUND_Y - bh * 0.6, bw * 0.5, bh * 0.6);
    }
    for (let x = 30; x < WORLD_W; x += 90 + ((x * 13) % 60)) {
      g.fillStyle(lvl.flowerColor, 0.85);
      g.fillCircle(x, GROUND_Y - 10, 4);
    }
  }

  // ── Overlay (platforms, fireflies, powerups) ───────────────────────────────

  _buildOverlay() {
    if (this.overlayGfx) this.overlayGfx.destroy();
    this.overlayGfx = this.add.graphics();
    this._redrawOverlay();
  }

  _redrawOverlay() {
    const g = this.overlayGfx;
    g.clear();
    const lvl = this._currentLvlTheme();

    // Static platforms
    EditorState.platforms.forEach((p, i) => {
      this._drawPlatRect(g, p, lvl, i);
    });

    // Spikes
    EditorState.spikes.forEach(s => {
      g.fillStyle(0xcc3333, 0.9);
      const count = Math.floor(s.w / 10);
      for (let i = 0; i < count; i++) {
        const sx = s.x + i * 10;
        g.fillTriangle(sx, GROUND_Y, sx + 5, GROUND_Y - 12, sx + 10, GROUND_Y);
      }
    });

    // Fireflies
    EditorState.fireflies.forEach(ff => {
      g.fillStyle(0xffdd44, 0.9);
      g.fillCircle(ff.x, ff.y, 10);
      g.lineStyle(2, 0xffeeaa, 0.7);
      g.strokeCircle(ff.x, ff.y, 10);
    });

    // Powerups
    const puColors = { double_jump: 0x44aaff, speed: 0xffaa22, heart: 0xff3355 };
    EditorState.powerups.forEach(pu => {
      const col = puColors[pu.type] ?? 0xffffff;
      g.fillStyle(col, 0.85);
      g.fillRoundedRect(pu.x - 14, pu.y - 14, 28, 28, 6);
      g.lineStyle(2, 0xffffff, 0.5);
      g.strokeRoundedRect(pu.x - 14, pu.y - 14, 28, 28, 6);
    });

    // Enemies — orange blob + patrol range line
    EditorState.enemies.forEach(en => {
      g.lineStyle(1, 0xff8800, 0.35);
      g.beginPath(); g.moveTo(en.minX, en.y); g.lineTo(en.maxX, en.y); g.strokePath();
      g.fillStyle(0xff8800, 0.25);
      g.fillRect(en.minX, en.y - 14, en.maxX - en.minX, 28);
      g.fillStyle(0xff6600, 0.9);
      g.fillEllipse(en.x, en.y, 32, 22);
      g.fillStyle(0xff3300, 1);
      g.fillCircle(en.x, en.y - 8, 8);
      g.fillStyle(0xffeecc, 1);
      g.fillCircle(en.x - 4, en.y - 9, 3);
      g.fillCircle(en.x + 4, en.y - 9, 3);
      g.fillStyle(0x000000, 1);
      g.fillCircle(en.x - 3, en.y - 9, 1.5);
      g.fillCircle(en.x + 5, en.y - 9, 1.5);
      g.lineStyle(2, 0xff8800, 0.8);
      g.beginPath(); g.moveTo(en.minX, en.y - 8); g.lineTo(en.minX, en.y + 8); g.strokePath();
      g.beginPath(); g.moveTo(en.maxX, en.y - 8); g.lineTo(en.maxX, en.y + 8); g.strokePath();
    });

    // Flying enemies — bat silhouette + patrol range
    EditorState.flyingEnemies.forEach(fe => {
      // Patrol range band
      g.lineStyle(1, 0xaa44ff, 0.35);
      g.beginPath(); g.moveTo(fe.minX, fe.y); g.lineTo(fe.maxX, fe.y); g.strokePath();
      g.fillStyle(0x6622aa, 0.15);
      g.fillRect(fe.minX, fe.y - 20, fe.maxX - fe.minX, 40);
      // Wings
      g.fillStyle(0x6622aa, 0.85);
      g.fillTriangle(fe.x, fe.y + 6, fe.x - 20, fe.y - 4, fe.x, fe.y);
      g.fillTriangle(fe.x, fe.y + 6, fe.x + 20, fe.y - 4, fe.x, fe.y);
      // Body
      g.fillStyle(0x3a0a5a, 1);
      g.fillEllipse(fe.x, fe.y + 4, 18, 14);
      // Eyes
      g.fillStyle(0xff2222, 1);
      g.fillCircle(fe.x - 4, fe.y + 2, 2.5);
      g.fillCircle(fe.x + 4, fe.y + 2, 2.5);
      // Range markers
      g.lineStyle(2, 0xaa44ff, 0.8);
      g.beginPath(); g.moveTo(fe.minX, fe.y - 10); g.lineTo(fe.minX, fe.y + 10); g.strokePath();
      g.beginPath(); g.moveTo(fe.maxX, fe.y - 10); g.lineTo(fe.maxX, fe.y + 10); g.strokePath();
    });

    // Counters — void orb with "C" label and proximity ring
    EditorState.counters.forEach(ct => {
      g.fillStyle(0x110033, 0.85);
      g.fillCircle(ct.x, ct.y, 14);
      g.lineStyle(2, 0x5500ff, 0.9);
      g.strokeCircle(ct.x, ct.y, 14);
      g.lineStyle(1, 0x5500ff, 0.25);
      g.strokeCircle(ct.x, ct.y, ct.proximityR ?? 110); // proximity radius indicator
      g.fillStyle(0xffffff, 0.9);
      g.fillRect(ct.x - 1, ct.y - 8, 2, 10); // C approximation
      g.fillRect(ct.x - 5, ct.y - 8, 6, 2);
      g.fillRect(ct.x - 5, ct.y + 0, 6, 2);
    });
  }

  _drawPlatRect(g, p, lvl, _idx) {
    const colors = lvl.platformColors;
    const c = colors[p.type] ?? colors.moss;
    g.fillStyle(c.shadow, 1);
    g.fillRoundedRect(p.x - p.w/2, p.y - p.h/2 + 5, p.w, p.h, 6);
    g.fillStyle(c.top, 1);
    g.fillRoundedRect(p.x - p.w/2, p.y - p.h/2, p.w, p.h - 3, 6);
  }

  // ── Grid ────────────────────────────────────────────────────────────────────

  _buildGrid() {
    if (this.gridGfx) this.gridGfx.destroy();
    this.gridGfx = this.add.graphics();
    this._redrawGrid();
  }

  _redrawGrid() {
    const g = this.gridGfx;
    g.clear();
    if (!EditorState.gridEnabled) return;
    const gs = EditorState.gridSize * 4; // 32px visual grid
    g.lineStyle(1, 0x1e4a3a, 0.35);
    for (let x = 0; x < WORLD_W; x += gs) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, VIEW_H); g.strokePath();
    }
    for (let y = 0; y < VIEW_H; y += gs) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(WORLD_W, y); g.strokePath();
    }
  }

  // ── Selection highlight ─────────────────────────────────────────────────────

  _buildSelectionHighlight() {
    if (this.selGfx) this.selGfx.destroy();
    this.selGfx = this.add.graphics();
  }

  _updateSelectionHighlight() {
    const g = this.selGfx;
    g.clear();
    if (!EditorState.selectedObj) return;
    const obj = this._getSelectedData();
    if (!obj) return;

    g.lineStyle(2, 0xffffff, 0.9);
    if (obj._category === 'firefly') {
      g.strokeCircle(obj.x, obj.y, 14);
    } else if (obj._category === 'powerup') {
      g.strokeRoundedRect(obj.x - 16, obj.y - 16, 32, 32, 5);
    } else if (obj._category === 'enemy') {
      g.lineStyle(2, 0xffdd00, 0.95);
      g.strokeCircle(obj.x, obj.y, 20);
    } else if (obj._category === 'flyingEnemy') {
      g.lineStyle(2, 0xdd88ff, 0.95);
      g.strokeCircle(obj.x, obj.y, 22);
    } else if (obj._category === 'counter') {
      g.lineStyle(2, 0x8866ff, 0.95);
      g.strokeCircle(obj.x, obj.y, 18);
    } else if (obj._category === 'spike') {
      g.strokeRect(obj.x, GROUND_Y - 14, obj.w, 14);
    } else {
      // platform
      g.strokeRoundedRect(obj.x - obj.w/2 - 2, obj.y - obj.h/2 - 2, obj.w + 4, obj.h + 4, 7);
    }
  }

  _getSelectedData() {
    const sel = EditorState.selectedObj;
    if (!sel) return null;
    const arr = this._getArray(sel.category);
    const obj = arr[sel.index];
    if (!obj) return null;
    return { ...obj, _category: sel.category };
  }

  _getArray(category) {
    const map = {
      platform:     EditorState.platforms,
      spike:        EditorState.spikes,
      firefly:      EditorState.fireflies,
      powerup:      EditorState.powerups,
      enemy:        EditorState.enemies,
      flyingEnemy:  EditorState.flyingEnemies,
      counter:      EditorState.counters,
    };
    return map[category] ?? [];
  }

  // ── Input binding ───────────────────────────────────────────────────────────

  _bindInput() {
    // Keyboard: arrow keys scroll camera, G toggles grid
    this.input.keyboard.on('keydown-LEFT',  () => this._scrollCam(-200));
    this.input.keyboard.on('keydown-RIGHT', () => this._scrollCam( 200));
    this.input.keyboard.on('keydown-A',     () => this._scrollCam(-200));
    this.input.keyboard.on('keydown-D',     () => this._scrollCam( 200));
    this.input.keyboard.on('keydown-G', () => {
      EditorState.gridEnabled = !EditorState.gridEnabled;
      this._redrawGrid();
      setStatus('Grid ' + (EditorState.gridEnabled ? 'aan' : 'uit'));
    });

    // Pointer events
    this.input.on('pointerdown', this._onPointerDown.bind(this));
    this.input.on('pointermove', this._onPointerMove.bind(this));
    this.input.on('pointerup',   this._onPointerUp.bind(this));

    // Ghost graphics for placement preview
    this.ghostGfx = this.add.graphics();
  }

  _scrollCam(dx) {
    this.camX = Phaser.Math.Clamp(this.camX + dx, 0, WORLD_W - VIEW_W);
    this.cameras.main.scrollX = this.camX;
  }

  // ── Pointer event handlers ──────────────────────────────────────────────────

  _worldX(pointer) { return pointer.x + this.cameras.main.scrollX; }
  _worldY(pointer) { return pointer.y + this.cameras.main.scrollY; }

  _onPointerDown(pointer) {
    const wx = this._worldX(pointer);
    const wy = this._worldY(pointer);
    const tool = EditorState.tool;

    if (tool === 'delete') {
      this._tryDelete(wx, wy);
      return;
    }

    // Check if clicking an existing object → start drag
    const hit = this._hitTest(wx, wy);
    if (hit && (tool === 'place-platform' || tool === 'place-firefly' || tool === 'place-powerup' || tool === 'place-enemy' || tool === 'place-flyer' || tool === 'place-counter')) {
      // Select and begin drag
      EditorState.selectedObj = { category: hit.category, index: hit.index };
      this._updateSelectionHighlight();
      this._updateSelectedPanel();
      const obj = this._getArray(hit.category)[hit.index];
      this.isDragging = true;
      this.dragObj = { category: hit.category, index: hit.index, startObjX: obj.x, startObjY: obj.y, startMX: wx, startMY: wy };
      setStatus('Verslepen…');
      return;
    }

    // Place new object
    if (tool === 'place-platform') this._placePlatform(wx, wy);
    else if (tool === 'place-firefly') this._placeFirefly(wx, wy);
    else if (tool === 'place-powerup') this._placePowerup(wx, wy);
    else if (tool === 'place-enemy')   this._placeEnemy(wx, wy);
    else if (tool === 'place-flyer')   this._placeFlyer(wx, wy);
    else if (tool === 'place-counter') this._placeCounter(wx, wy);
  }

  _onPointerMove(pointer) {
    const wx = this._worldX(pointer);
    const wy = this._worldY(pointer);

    if (this.isDragging && this.dragObj) {
      const arr = this._getArray(this.dragObj.category);
      const obj = arr[this.dragObj.index];
      const dx = wx - this.dragObj.startMX;
      const dy = wy - this.dragObj.startMY;
      const newX = snapToGrid(this.dragObj.startObjX + dx, EditorState.gridSize);
      const newY = snapToGrid(this.dragObj.startObjY + dy, EditorState.gridSize);
      if (this.dragObj.category === 'enemy' || this.dragObj.category === 'flyingEnemy') {
        const deltaX = newX - obj.x;
        obj.minX += deltaX;
        obj.maxX += deltaX;
      }
      obj.x = newX;
      obj.y = newY;
      this._redrawOverlay();
      this._updateSelectionHighlight();
      setStatus(`x=${newX}  y=${newY}`);
      return;
    }

    // Ghost preview
    this._drawGhost(wx, wy);
  }

  _onPointerUp(_pointer) {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragObj    = null;
      this._redrawOverlay();
      setStatus('Losgelaten. Vergeet niet op te slaan!');
    }
  }

  _drawGhost(wx, wy) {
    const g = this.ghostGfx;
    g.clear();
    const tool = EditorState.tool;
    const sx = snapToGrid(wx, EditorState.gridSize);
    const sy = snapToGrid(wy, EditorState.gridSize);

    if (tool === 'place-platform') {
      const lvl = this._currentLvlTheme();
      const c = lvl.platformColors[EditorState.newPlat.type] ?? lvl.platformColors.moss;
      const pw = EditorState.newPlat.w;
      const ph = EditorState.newPlat.h;
      g.fillStyle(c.top, 0.5);
      g.fillRoundedRect(sx - pw/2, sy - ph/2, pw, ph, 5);
      g.lineStyle(1, 0xffffff, 0.5);
      g.strokeRoundedRect(sx - pw/2, sy - ph/2, pw, ph, 5);
    } else if (tool === 'place-firefly') {
      g.fillStyle(0xffdd44, 0.5);
      g.fillCircle(sx, sy, 10);
      g.lineStyle(1, 0xffeeaa, 0.5); g.strokeCircle(sx, sy, 10);
    } else if (tool === 'place-powerup') {
      const puColors = { double_jump: 0x44aaff, speed: 0xffaa22, heart: 0xff3355 };
      g.fillStyle(puColors[EditorState.newPuType] ?? 0xffffff, 0.5);
      g.fillRoundedRect(sx - 14, sy - 14, 28, 28, 6);
    } else if (tool === 'place-enemy') {
      const hw = Math.floor(EditorState.newEnemy.patrolW / 2);
      g.fillStyle(0xff8800, 0.2);
      g.fillRect(sx - hw, sy - 14, EditorState.newEnemy.patrolW, 28);
      g.fillStyle(0xff6600, 0.6);
      g.fillEllipse(sx, sy, 32, 22);
      g.fillStyle(0xff3300, 0.7);
      g.fillCircle(sx, sy - 8, 8);
    } else if (tool === 'place-flyer') {
      const hw = Math.floor(EditorState.newFlyer.patrolW / 2);
      g.fillStyle(0x6622aa, 0.15);
      g.fillRect(sx - hw, sy - 20, EditorState.newFlyer.patrolW, 40);
      g.fillStyle(0x6622aa, 0.6);
      g.fillTriangle(sx, sy + 6, sx - 20, sy - 4, sx, sy);
      g.fillTriangle(sx, sy + 6, sx + 20, sy - 4, sx, sy);
      g.fillStyle(0x3a0a5a, 0.8);
      g.fillEllipse(sx, sy + 4, 18, 14);
    } else if (tool === 'place-counter') {
      g.fillStyle(0x5500ff, 0.3);
      g.fillCircle(sx, sy, 14);
      g.lineStyle(1, 0x8866ff, 0.7);
      g.strokeCircle(sx, sy, 14);
      g.lineStyle(1, 0x5500ff, 0.2);
      g.strokeCircle(sx, sy, 110);
    } else if (tool === 'delete') {
      g.fillStyle(0xff3333, 0.3);
      g.fillCircle(sx, sy, 14);
    }
  }

  // ── Object placement ────────────────────────────────────────────────────────

  _placePlatform(wx, wy) {
    const np = EditorState.newPlat;
    const sx = snapToGrid(wx, EditorState.gridSize);
    const sy = snapToGrid(wy, EditorState.gridSize);
    const p = { x: sx, y: sy, w: np.w, h: np.h, type: np.type };
    EditorState.platforms.push(p);
    EditorState.selectedObj = { category: 'platform', index: EditorState.platforms.length - 1 };
    this._redrawOverlay();
    this._updateSelectionHighlight();
    this._updateSelectedPanel();
    setStatus(`Platform geplaatst op x=${sx} y=${sy}`);
  }

  _placeFirefly(wx, wy) {
    const sx = snapToGrid(wx, EditorState.gridSize);
    const sy = snapToGrid(wy, EditorState.gridSize);
    EditorState.fireflies.push({ x: sx, y: sy });
    EditorState.selectedObj = { category: 'firefly', index: EditorState.fireflies.length - 1 };
    this._redrawOverlay();
    this._updateSelectionHighlight();
    setStatus(`Vuurvliegje geplaatst op x=${sx} y=${sy}`);
  }

  _placePowerup(wx, wy) {
    const sx = snapToGrid(wx, EditorState.gridSize);
    const sy = snapToGrid(wy, EditorState.gridSize);
    EditorState.powerups.push({ x: sx, y: sy, type: EditorState.newPuType });
    EditorState.selectedObj = { category: 'powerup', index: EditorState.powerups.length - 1 };
    this._redrawOverlay();
    this._updateSelectionHighlight();
    setStatus(`Powerup (${EditorState.newPuType}) geplaatst op x=${sx} y=${sy}`);
  }

  // ── Hit testing ─────────────────────────────────────────────────────────────

  _hitTest(wx, wy) {
    // Test in reverse order: topmost drawn first
    // Counters (r=14)
    for (let i = EditorState.counters.length - 1; i >= 0; i--) {
      const ct = EditorState.counters[i];
      if (Math.hypot(wx - ct.x, wy - ct.y) <= 16)
        return { category: 'counter', index: i };
    }
    // Flying enemies (body ~20x16)
    for (let i = EditorState.flyingEnemies.length - 1; i >= 0; i--) {
      const fe = EditorState.flyingEnemies[i];
      if (Math.abs(wx - fe.x) <= 20 && Math.abs(wy - fe.y) <= 16)
        return { category: 'flyingEnemy', index: i };
    }
    // Enemies (body ~16x18)
    for (let i = EditorState.enemies.length - 1; i >= 0; i--) {
      const e = EditorState.enemies[i];
      if (Math.abs(wx - e.x) <= 16 && Math.abs(wy - e.y) <= 14)
        return { category: 'enemy', index: i };
    }
    // Powerups (28x28 box)
    for (let i = EditorState.powerups.length - 1; i >= 0; i--) {
      const p = EditorState.powerups[i];
      if (Math.abs(wx - p.x) <= 14 && Math.abs(wy - p.y) <= 14)
        return { category: 'powerup', index: i };
    }
    // Fireflies (r=12)
    for (let i = EditorState.fireflies.length - 1; i >= 0; i--) {
      const f = EditorState.fireflies[i];
      if (Math.hypot(wx - f.x, wy - f.y) <= 12)
        return { category: 'firefly', index: i };
    }
    // Static platforms
    for (let i = EditorState.platforms.length - 1; i >= 0; i--) {
      const p = EditorState.platforms[i];
      if (wx >= p.x - p.w/2 && wx <= p.x + p.w/2 && wy >= p.y - p.h/2 && wy <= p.y + p.h/2)
        return { category: 'platform', index: i };
    }
    return null;
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  _tryDelete(wx, wy) {
    const hit = this._hitTest(wx, wy);
    if (!hit) { setStatus('Niets gevonden om te verwijderen.'); return; }
    const arr = this._getArray(hit.category);
    arr.splice(hit.index, 1);
    EditorState.selectedObj = null;
    this.selGfx.clear();
    this._updateSelectedPanel();
    this._redrawOverlay();
    setStatus(`Object (${hit.category}) verwijderd.`);
  }

  deleteSelected() {
    const sel = EditorState.selectedObj;
    if (!sel) return;
    const arr = this._getArray(sel.category);
    arr.splice(sel.index, 1);
    EditorState.selectedObj = null;
    this.selGfx.clear();
    this._updateSelectedPanel();
    this._redrawOverlay();
    setStatus('Geselecteerd object verwijderd.');
  }

  // ── Selected panel sync ─────────────────────────────────────────────────────

  _updateSelectedPanel() {
    const panel    = document.getElementById('panel-selected');
    const infoEl   = document.getElementById('selected-info');
    const platFlds = document.getElementById('selected-platform-fields');

    if (!EditorState.selectedObj) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');

    const obj = this._getSelectedData();
    if (!obj) { panel.classList.add('hidden'); return; }

    const cat = obj._category;
    const isPlatform = cat === 'platform';

    let desc = cat;
    if (isPlatform) desc = `platform — type: ${obj.type}  ${obj.w}×${obj.h}`;
    if (cat === 'firefly')     desc = `Vuurvliegje  x=${obj.x}  y=${obj.y}`;
    if (cat === 'powerup')     desc = `Powerup (${obj.type})  x=${obj.x}  y=${obj.y}`;
    if (cat === 'enemy')       desc = `Vijand  x=${obj.x}  y=${obj.y}  snelheid=${obj.speed}`;
    if (cat === 'flyingEnemy') desc = `Flyer  x=${obj.x}  y=${obj.y}  snelheid=${obj.speed}`;
    if (cat === 'counter')     desc = `Counter  x=${obj.x}  y=${obj.y}  chase=${obj.chaseSpeed ?? 28}  r=${obj.proximityR ?? 110}  tick=${Math.round((obj.tickInterval ?? 333) / 100) / 10}s`;
    infoEl.textContent = desc;

    const enemyFlds   = document.getElementById('selected-enemy-fields');
    const flyerFlds   = document.getElementById('selected-flyer-fields');
    const counterFlds = document.getElementById('selected-counter-fields');

    platFlds.classList.add('hidden');
    if (enemyFlds)   enemyFlds.classList.add('hidden');
    if (flyerFlds)   flyerFlds.classList.add('hidden');
    if (counterFlds) counterFlds.classList.add('hidden');

    if (isPlatform) {
      platFlds.classList.remove('hidden');
      const radio = document.querySelector(`input[name="sel-type"][value="${obj.type}"]`);
      if (radio) radio.checked = true;
      const sw = document.getElementById('sel-plat-w');
      const sh = document.getElementById('sel-plat-h');
      if (sw) { sw.value = obj.w; document.getElementById('sel-plat-w-val').textContent = obj.w; }
      if (sh) { sh.value = obj.h; document.getElementById('sel-plat-h-val').textContent = obj.h; }
    } else if (cat === 'enemy') {
      if (enemyFlds) {
        enemyFlds.classList.remove('hidden');
        const sMinX  = document.getElementById('sel-enemy-minx');
        const sMaxX  = document.getElementById('sel-enemy-maxx');
        const sSpeed = document.getElementById('sel-enemy-speed');
        if (sMinX)  { sMinX.value  = obj.minX;  document.getElementById('sel-enemy-minx-val').textContent  = obj.minX; }
        if (sMaxX)  { sMaxX.value  = obj.maxX;  document.getElementById('sel-enemy-maxx-val').textContent  = obj.maxX; }
        if (sSpeed) { sSpeed.value = obj.speed; document.getElementById('sel-enemy-speed-val').textContent = obj.speed; }
      }
    } else if (cat === 'flyingEnemy') {
      if (flyerFlds) {
        flyerFlds.classList.remove('hidden');
        const sMinX  = document.getElementById('sel-flyer-minx');
        const sMaxX  = document.getElementById('sel-flyer-maxx');
        const sSpeed = document.getElementById('sel-flyer-speed');
        const sShoot = document.getElementById('sel-flyer-shoot');
        const shootSec = Math.round((obj.shootInterval ?? 8000) / 1000);
        if (sMinX)  { sMinX.value  = obj.minX;   document.getElementById('sel-flyer-minx-val').textContent  = obj.minX; }
        if (sMaxX)  { sMaxX.value  = obj.maxX;   document.getElementById('sel-flyer-maxx-val').textContent  = obj.maxX; }
        if (sSpeed) { sSpeed.value = obj.speed;  document.getElementById('sel-flyer-speed-val').textContent = obj.speed; }
        if (sShoot) { sShoot.value = shootSec;   document.getElementById('sel-flyer-shoot-val').textContent = shootSec; }
      }
    } else if (cat === 'counter') {
      if (counterFlds) {
        counterFlds.classList.remove('hidden');
        const sChase = document.getElementById('sel-counter-chase');
        const sProx  = document.getElementById('sel-counter-prox');
        const sTick  = document.getElementById('sel-counter-tick');
        const tickSec = Math.round((obj.tickInterval ?? 333) / 1000 * 10) / 10;
        if (sChase) { sChase.value = obj.chaseSpeed  ?? 28;  document.getElementById('sel-counter-chase-val').textContent = obj.chaseSpeed  ?? 28; }
        if (sProx)  { sProx.value  = obj.proximityR  ?? 110; document.getElementById('sel-counter-prox-val').textContent  = obj.proximityR  ?? 110; }
        if (sTick)  { sTick.value  = tickSec;                 document.getElementById('sel-counter-tick-val').textContent  = tickSec; }
      }
    }
  }

  applySelectedCounterProp(prop, val) {
    const sel = EditorState.selectedObj;
    if (!sel || sel.category !== 'counter') return;
    EditorState.counters[sel.index][prop] = val;
    this._redrawOverlay();
    this._updateSelectionHighlight();
    this._updateSelectedPanel();
  }

  applySelectedType(type) {
    const sel = EditorState.selectedObj;
    if (!sel) return;
    const arr = this._getArray(sel.category);
    if (arr[sel.index]) arr[sel.index].type = type;
    this._redrawOverlay();
    this._updateSelectedPanel();
  }

  applySelectedW(w) {
    const sel = EditorState.selectedObj;
    if (!sel) return;
    const arr = this._getArray(sel.category);
    if (arr[sel.index]) arr[sel.index].w = w;
    this._redrawOverlay();
  }

  applySelectedH(h) {
    const sel = EditorState.selectedObj;
    if (!sel) return;
    const arr = this._getArray(sel.category);
    if (arr[sel.index]) arr[sel.index].h = h;
    this._redrawOverlay();
  }

  applySelectedEnemyProp(prop, val) {
    const sel = EditorState.selectedObj;
    if (!sel || sel.category !== 'enemy') return;
    EditorState.enemies[sel.index][prop] = val;
    this._redrawOverlay();
    this._updateSelectionHighlight();
    this._updateSelectedPanel();
  }

  applySelectedFlyerProp(prop, val) {
    const sel = EditorState.selectedObj;
    if (!sel || sel.category !== 'flyingEnemy') return;
    EditorState.flyingEnemies[sel.index][prop] = val;
    this._redrawOverlay();
    this._updateSelectionHighlight();
    this._updateSelectedPanel();
  }

  _placeEnemy(wx, wy) {
    const sx   = snapToGrid(wx, EditorState.gridSize);
    const sy   = snapToGrid(wy, EditorState.gridSize);
    const hw   = Math.floor(EditorState.newEnemy.patrolW / 2);
    const en   = { x: sx, y: sy, minX: sx - hw, maxX: sx + hw, speed: EditorState.newEnemy.speed };
    EditorState.enemies.push(en);
    EditorState.selectedObj = { category: 'enemy', index: EditorState.enemies.length - 1 };
    this._redrawOverlay();
    this._updateSelectionHighlight();
    this._updateSelectedPanel();
    setStatus(`Vijand geplaatst op x=${sx} y=${sy}`);
  }

  _placeFlyer(wx, wy) {
    const sx = snapToGrid(wx, EditorState.gridSize);
    const sy = snapToGrid(wy, EditorState.gridSize);
    const hw = Math.floor(EditorState.newFlyer.patrolW / 2);
    const fe = {
      x: sx, y: sy,
      minX: sx - hw, maxX: sx + hw,
      speed: EditorState.newFlyer.speed,
      shootInterval: EditorState.newFlyer.shootInterval,
    };
    EditorState.flyingEnemies.push(fe);
    EditorState.selectedObj = { category: 'flyingEnemy', index: EditorState.flyingEnemies.length - 1 };
    this._redrawOverlay();
    this._updateSelectionHighlight();
    this._updateSelectedPanel();
    setStatus(`Flyer geplaatst op x=${sx} y=${sy}`);
  }

  _placeCounter(wx, wy) {
    const sx = snapToGrid(wx, EditorState.gridSize);
    const sy = snapToGrid(wy, EditorState.gridSize);
    EditorState.counters.push({
      x: sx, y: sy,
      chaseSpeed:   EditorState.newCounter.chaseSpeed,
      proximityR:   EditorState.newCounter.proximityR,
      tickInterval: EditorState.newCounter.tickInterval,
    });
    EditorState.selectedObj = { category: 'counter', index: EditorState.counters.length - 1 };
    this._redrawOverlay();
    this._updateSelectionHighlight();
    this._updateSelectedPanel();
    setStatus(`Counter geplaatst op x=${sx} y=${sy}`);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  _currentLvlTheme() {
    return LEVELS[EditorState.currentLevel];
  }

  rebuildAll() {
    this.ghostGfx.clear();
    EditorState.selectedObj = null;
    loadLevelData(EditorState.currentLevel);
    this._buildWorld();
    this._buildOverlay();
    this._buildGrid();
    this._buildSelectionHighlight();
    this.cameras.main.scrollX = 0;
    this.camX = 0;
    this._updateSelectedPanel();
    setStatus('Level herladen.');
  }
}

// ─── Phaser initialisation ────────────────────────────────────────────────────

// Load levels.json first, then boot Phaser so LEVELS is populated before any scene runs
fetch('levels.json')
  .then(r => r.json())
  .then(data => {
    LEVELS = data;
    // Populate the level dropdown now that LEVELS is available
    const sel = document.getElementById('level-select');
    if (sel && sel.children.length === 0) {
      LEVELS.forEach((lvl, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = 'Level ' + (i + 1) + ' \u2014 ' + lvl.name;
        sel.appendChild(opt);
      });
    }
    new Phaser.Game({
      type: Phaser.CANVAS,
      width: VIEW_W,
      height: VIEW_H,
      parent: 'game-container',
      backgroundColor: '#060d1a',
      physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
      scene: [EditorScene],
    });
  })
  .catch(err => console.error('Failed to load levels.json:', err));

// ─── Sidebar wiring (runs after DOM is ready) ─────────────────────────────────

function getEditorScene() {
  // Phaser game is window.game (set below)
  return window._editorGame && window._editorGame.scene.getScene('EditorScene');
}

document.addEventListener('DOMContentLoaded', () => {
  // Grab Phaser game instance from global (set by Phaser itself into window.game won't work,
  // so we store it in a known place when the scene starts)
});

// Phaser stores the game on the window only in some configs. We'll capture it differently:
// Once Phaser is ready it calls EditorScene.create(). We wire sidebar events right away
// since they call into EditorState and the scene via a helper that waits.

function withScene(fn) {
  // Retry until scene is available
  const attempt = () => {
    const s = window._editorScene;
    if (s) { fn(s); }
    else    { setTimeout(attempt, 50); }
  };
  attempt();
}

// Store scene reference in create (patch into prototype after class definition)
const _origCreate = EditorScene.prototype.create;
EditorScene.prototype.create = function() {
  _origCreate.call(this);
  window._editorScene = this;
};

// ── Level selector ────────────────────────────────────────────────────────────
document.getElementById('level-select').addEventListener('change', e => {
  EditorState.currentLevel = parseInt(e.target.value);
  withScene(s => s.rebuildAll());
});

// ── Tool buttons ──────────────────────────────────────────────────────────────
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    EditorState.tool = btn.dataset.tool;

    // Show/hide panels
    const panPlat    = document.getElementById('panel-platform');
    const panPu      = document.getElementById('panel-powerup');
    const panEnemy   = document.getElementById('panel-enemy');
    const panFlyer   = document.getElementById('panel-flyer');
    const panCounter = document.getElementById('panel-counter');
    panPlat.classList.toggle('hidden',    EditorState.tool !== 'place-platform');
    panPu.classList.toggle('hidden',      EditorState.tool !== 'place-powerup');
    panEnemy.classList.toggle('hidden',   EditorState.tool !== 'place-enemy');
    panFlyer.classList.toggle('hidden',   EditorState.tool !== 'place-flyer');
    panCounter.classList.toggle('hidden', EditorState.tool !== 'place-counter');

    // Cursor class on container
    const c = document.getElementById('game-container');
    c.className = '';
    if (EditorState.tool === 'place-platform' || EditorState.tool === 'place-firefly' || EditorState.tool === 'place-powerup' || EditorState.tool === 'place-enemy' || EditorState.tool === 'place-flyer' || EditorState.tool === 'place-counter')
      c.classList.add('tool-place');
    else if (EditorState.tool === 'delete')
      c.classList.add('tool-delete');

    withScene(s => s.ghostGfx && s.ghostGfx.clear());
    setStatus(`Tool: ${EditorState.tool}`);
  });
});

// ── Platform property controls ────────────────────────────────────────────────
document.querySelectorAll('input[name="plat-type"]').forEach(r => {
  r.addEventListener('change', e => { EditorState.newPlat.type = e.target.value; });
});

const platW = document.getElementById('plat-w');
const platH = document.getElementById('plat-h');
platW.addEventListener('input', () => {
  EditorState.newPlat.w = parseInt(platW.value);
  document.getElementById('plat-w-val').textContent = platW.value;
});
platH.addEventListener('input', () => {
  EditorState.newPlat.h = parseInt(platH.value);
  document.getElementById('plat-h-val').textContent = platH.value;
});

// ── Powerup type ──────────────────────────────────────────────────────────────
document.querySelectorAll('input[name="pu-type"]').forEach(r => {
  r.addEventListener('change', e => { EditorState.newPuType = e.target.value; });
});

// ── Enemy new-object controls ─────────────────────────────────────────────────
document.getElementById('enemy-patrol-w').addEventListener('input', e => {
  EditorState.newEnemy.patrolW = parseInt(e.target.value);
  document.getElementById('enemy-patrol-w-val').textContent = e.target.value;
});
document.getElementById('enemy-speed').addEventListener('input', e => {
  EditorState.newEnemy.speed = parseInt(e.target.value);
  document.getElementById('enemy-speed-val').textContent = e.target.value;
});

// ── Flyer new-object controls ─────────────────────────────────────────────────
document.getElementById('flyer-patrol-w').addEventListener('input', e => {
  EditorState.newFlyer.patrolW = parseInt(e.target.value);
  document.getElementById('flyer-patrol-w-val').textContent = e.target.value;
});
document.getElementById('flyer-speed').addEventListener('input', e => {
  EditorState.newFlyer.speed = parseInt(e.target.value);
  document.getElementById('flyer-speed-val').textContent = e.target.value;
});
document.getElementById('flyer-shoot').addEventListener('input', e => {
  EditorState.newFlyer.shootInterval = parseInt(e.target.value) * 1000;
  document.getElementById('flyer-shoot-val').textContent = e.target.value;
});

// ── Selected enemy controls ───────────────────────────────────────────────────
document.getElementById('sel-enemy-minx').addEventListener('input', e => {
  document.getElementById('sel-enemy-minx-val').textContent = e.target.value;
  withScene(s => s.applySelectedEnemyProp('minX', parseInt(e.target.value)));
});
document.getElementById('sel-enemy-maxx').addEventListener('input', e => {
  document.getElementById('sel-enemy-maxx-val').textContent = e.target.value;
  withScene(s => s.applySelectedEnemyProp('maxX', parseInt(e.target.value)));
});
document.getElementById('sel-enemy-speed').addEventListener('input', e => {
  document.getElementById('sel-enemy-speed-val').textContent = e.target.value;
  withScene(s => s.applySelectedEnemyProp('speed', parseInt(e.target.value)));
});

// ── Selected flyer controls ───────────────────────────────────────────────────
document.getElementById('sel-flyer-minx').addEventListener('input', e => {
  document.getElementById('sel-flyer-minx-val').textContent = e.target.value;
  withScene(s => s.applySelectedFlyerProp('minX', parseInt(e.target.value)));
});
document.getElementById('sel-flyer-maxx').addEventListener('input', e => {
  document.getElementById('sel-flyer-maxx-val').textContent = e.target.value;
  withScene(s => s.applySelectedFlyerProp('maxX', parseInt(e.target.value)));
});
document.getElementById('sel-flyer-speed').addEventListener('input', e => {
  document.getElementById('sel-flyer-speed-val').textContent = e.target.value;
  withScene(s => s.applySelectedFlyerProp('speed', parseInt(e.target.value)));
});
document.getElementById('sel-flyer-shoot').addEventListener('input', e => {
  document.getElementById('sel-flyer-shoot-val').textContent = e.target.value;
  withScene(s => s.applySelectedFlyerProp('shootInterval', parseInt(e.target.value) * 1000));
});

// ── Counter new-object controls ───────────────────────────────────────────────
document.getElementById('counter-chase').addEventListener('input', e => {
  EditorState.newCounter.chaseSpeed = parseInt(e.target.value);
  document.getElementById('counter-chase-val').textContent = e.target.value;
});
document.getElementById('counter-prox').addEventListener('input', e => {
  EditorState.newCounter.proximityR = parseInt(e.target.value);
  document.getElementById('counter-prox-val').textContent = e.target.value;
});
document.getElementById('counter-tick').addEventListener('input', e => {
  EditorState.newCounter.tickInterval = Math.round(parseFloat(e.target.value) * 1000);
  document.getElementById('counter-tick-val').textContent = e.target.value;
});

// ── Selected counter controls ─────────────────────────────────────────────────
document.getElementById('sel-counter-chase').addEventListener('input', e => {
  document.getElementById('sel-counter-chase-val').textContent = e.target.value;
  withScene(s => s.applySelectedCounterProp('chaseSpeed', parseInt(e.target.value)));
});
document.getElementById('sel-counter-prox').addEventListener('input', e => {
  document.getElementById('sel-counter-prox-val').textContent = e.target.value;
  withScene(s => s.applySelectedCounterProp('proximityR', parseInt(e.target.value)));
});
document.getElementById('sel-counter-tick').addEventListener('input', e => {
  document.getElementById('sel-counter-tick-val').textContent = e.target.value;
  withScene(s => s.applySelectedCounterProp('tickInterval', Math.round(parseFloat(e.target.value) * 1000)));
});
// ── Selected object controls ──────────────────────────────────────────────────
document.querySelectorAll('input[name="sel-type"]').forEach(r => {
  r.addEventListener('change', e => {
    withScene(s => s.applySelectedType(e.target.value));
  });
});

const selW = document.getElementById('sel-plat-w');
const selH = document.getElementById('sel-plat-h');
selW.addEventListener('input', () => {
  document.getElementById('sel-plat-w-val').textContent = selW.value;
  withScene(s => s.applySelectedW(parseInt(selW.value)));
});
selH.addEventListener('input', () => {
  document.getElementById('sel-plat-h-val').textContent = selH.value;
  withScene(s => s.applySelectedH(parseInt(selH.value)));
});

document.getElementById('btn-delete-selected').addEventListener('click', () => {
  withScene(s => s.deleteSelected());
});

// ── Action buttons ─────────────────────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', () => {
  saveLevelData(EditorState.currentLevel);
});

document.getElementById('btn-test').addEventListener('click', () => {
  saveLevelData(EditorState.currentLevel);
  window.open('index.html', '_blank');
});

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm(`Level ${EditorState.currentLevel + 1} terugzetten naar standaard? Alle bewerkingen gaan verloren.`)) return;
  localStorage.removeItem('mm_level_' + EditorState.currentLevel);
  withScene(s => s.rebuildAll());
  setStatus('Level teruggezet naar standaard.');
});

document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (!confirm('Alle objecten uit dit level verwijderen? (Platforms, vijanden, vuurvliegjes, powerups, spikes)')) return;
  EditorState.platforms     = [];
  EditorState.spikes        = [];
  EditorState.fireflies     = [];
  EditorState.powerups      = [];
  EditorState.enemies       = [];
  EditorState.flyingEnemies = [];
  EditorState.counters      = [];
  EditorState.selectedObj   = null;
  withScene(s => {
    s.selGfx.clear();
    s._redrawOverlay();
    s._updateSelectedPanel();
  });
  setStatus('Alle objecten verwijderd. Vergeet niet op te slaan!');
});

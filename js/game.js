/**
 * Moss & Moonlight ? Enchanted Forest Platformer
 * Controls: arrows or WASD to move/jump, touch buttons on mobile
 */

// ??? Constants ????????????????????????????????????????????????????????????????

const WORLD_W  = 3200;
const VIEW_W   = 800;
const VIEW_H   = 600;
const GROUND_Y = VIEW_H - 40;

// ??? i18n ?????????????????????????????????????????????????????????????????????
// window.I18N_DATA and window.T() are set up in the startup block after fetching

let I18N_DATA = {};
function T(key, ...args) {
  const lang = window.LANG || 'nl';
  let s = (I18N_DATA[lang] && I18N_DATA[lang][key])
       || (I18N_DATA['en']  && I18N_DATA['en'][key])
       || key;
  args.forEach((a, i) => { s = s.replace('{' + i + '}', a); });
  return s;
}

// ??? Modifier state ???????????????????????????????????????????????????????????
// Persists across levels within a run; reset on full restart
if (!window.activeModifiers) window.activeModifiers = [];
let MODIFIERS_DATA = [];

function hasMod(id) { return window.activeModifiers.includes(id); }

// ??? Mobile input bridge ??????????????????????????????????????????????????????
const mobileInput = { left: false, right: false, jump: false };

// ??? Level definitions ????????????????????????????????????????????????????????
let LEVELS = [];

// ??? Game Scene ???????????????????????????????????????????????????????????????

class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  init(data) {
    this.currentLevel = (data && data.level != null) ? data.level : 0;
    this.playerLives  = (data && data.lives  != null) ? data.lives  : 3;
  }

  create() {
    this.firefliesCollected = 0;
    this.firefliesTotal     = 0;
    this.gameOver           = false;
    this.isHurt             = false;
    this.powerupList        = [];
    this.counterList        = [];
    this.lavaKillCooldown   = 0;

    this.hasDoubleJump  = false;
    this.hasSpeed       = false;
    this.doubleJumpUsed = false;
    this._jumpHolding   = false;
    this._jumpHoldTime  = 0;

    // Speed run timer (modifier)
    this._speedRunTime  = 0;
    this._speedRunLimit = 90000; // 90 seconds default

    // Apply extra_life modifier
    if (hasMod('extra_life')) {
      this.playerLives = Math.min(5, this.playerLives + 1);
    }

    const _saved = localStorage.getItem('mm_level_' + this.currentLevel);
    const lvl = _saved
      ? { ...LEVELS[this.currentLevel], ...JSON.parse(_saved) }
      : LEVELS[this.currentLevel];

    this.physics.world.setBounds(0, 0, WORLD_W, VIEW_H);

    this.generateSprites();
    this.createAnimations();
    this.createBackground(lvl);
    this.createGround(lvl);
    this.createPlatforms(lvl);
    this.createSpikes(lvl);
    this.createPowerups(lvl);
    this.createCollectibles(lvl);
    this.createShovel(lvl);
    this.createEnemies(lvl);
    this.createFlyingEnemies(lvl);
    this.createCounters(lvl);
    this.createPlayer(lvl);
    this.createAmbientDecoration(lvl);
    this.setupCollisions();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = {
      left:  this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up:    this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
    };

    this._setupCheatCodes();
    this.events.on('shutdown', () => { window.gameAdminAPI = null; });

    this.cameras.main.setBounds(0, 0, WORLD_W, VIEW_H);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.scene.launch('UIScene', { level: this.currentLevel, lives: this.playerLives });
  }

  // ?? Admin API ????????????????????????????????????????????????????????????????

  _setupCheatCodes() {
    window.gameAdminAPI = {
      jumpToLevel: (idx) => {
        if (idx < 0 || idx >= LEVELS.length) return;
        this._cheatToast(T('admin_level', idx + 1, LEVELS[idx].name));
        this.time.delayedCall(800, () => {
          this.scene.get('UIScene').scene.restart({ level: idx, lives: this.playerLives });
          this.scene.restart({ level: idx, lives: this.playerLives });
        });
      },
      skipLevel: () => {
        const next = this.currentLevel + 1;
        if (next < LEVELS.length) {
          this._cheatToast(T('admin_to_level', next + 1, LEVELS[next].name));
          this.time.delayedCall(800, () => {
            this.scene.get('UIScene').scene.restart({ level: next, lives: this.playerLives });
            this.scene.restart({ level: next, lives: this.playerLives });
          });
        } else {
          this._cheatToast(T('admin_last_level'));
          this.time.delayedCall(800, () => this.winLevel());
        }
      },
      restoreLives: () => {
        this.playerLives = 3;
        this.scene.get('UIScene').updateLives(this.playerLives);
        this._cheatToast(T('admin_lives'));
      },
      refreshLanguage: () => {
        const ui = this.scene.get('UIScene');
        if (ui && ui.refreshLanguage) ui.refreshLanguage();
      },
    };
  }

  _cheatToast(msg) {
    const toast = this.add
      .text(VIEW_W / 2, VIEW_H / 2 - 60, msg, {
        fontSize: '18px', fontFamily: 'Georgia',
        color: '#ffff88', backgroundColor: '#00000099',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5).setScrollFactor(0).setDepth(999);
    this.tweens.add({
      targets: toast, alpha: { from: 1, to: 0 },
      delay: 600, duration: 500,
      onComplete: () => toast.destroy(),
    });
  }

  // ?? Sprite generation ????????????????????????????????????????????????????????

  generateSprites() {
    if (!this.textures.exists('player_0')) {
      for (let f = 0; f < 6; f++) {
        const squash  = 1 - Math.abs(Math.sin(f * 0.5)) * 0.15;
        const stretch = 1 + Math.abs(Math.sin(f * 0.5)) * 0.10;
        const g = this.add.graphics();
        g.fillStyle(0xaaffaa, 0.95);
        g.fillEllipse(16, 16, 24 * stretch, 28 * squash);
        g.lineStyle(2, 0x66dd66, 0.9);
        g.strokeEllipse(16, 16, 24 * stretch, 28 * squash);
        g.fillStyle(0x1a3322, 1);
        g.fillCircle(12, 13, 2.2);
        g.fillCircle(20, 13, 2.2);
        g.generateTexture('player_' + f, 32, 32);
        g.destroy();
      }
      for (let f = 0; f < 4; f++) {
        const a = 0.5 + Math.sin(f * 1.57) * 0.4;
        const g = this.add.graphics();
        g.fillStyle(0xffeeaa, a); g.fillCircle(12, 12, 10);
        g.fillStyle(0xffdd44, a * 0.6); g.fillCircle(12, 12, 6);
        g.generateTexture('firefly_' + f, 24, 24); g.destroy();
      }
      for (let f = 0; f < 4; f++) {
        const g = this.add.graphics();
        const legOff  = [-4, -7, 0, 7][f];
        const bodyOff = [0, -1, 2, -1][f];
        const armAng  = [0, 14, 0, -14][f];
        const cx = 24, cy = 20 + bodyOff;
        g.fillStyle(0x000000, 0.22); g.fillEllipse(cx, 38, 28, 7);
        g.fillStyle(0x1a0d2e, 1);
        g.fillRoundedRect(cx - 10 + legOff, cy + 10, 8, 11, 3);
        g.fillRoundedRect(cx +  2 - legOff, cy + 10, 8, 11, 3);
        g.fillStyle(0x0d0820, 1);
        g.fillRoundedRect(cx - 12 + legOff, cy + 19, 11, 5, 2);
        g.fillRoundedRect(cx +  1 - legOff, cy + 19, 11, 5, 2);
        g.fillStyle(0x6622aa, 1);
        g.fillTriangle(cx - 13 + legOff, cy + 24, cx - 10 + legOff, cy + 22, cx - 12 + legOff, cy + 26);
        g.fillTriangle(cx +  0 - legOff, cy + 24, cx +  3 - legOff, cy + 22, cx +  1 - legOff, cy + 26);
        g.fillStyle(0x2a1040, 0.97); g.fillEllipse(cx, cy + 2, 26, 22);
        g.fillStyle(0x3d1a5a, 0.55); g.fillEllipse(cx, cy + 4, 14, 12);
        const laX = cx - 13, laY = cy - 2;
        g.fillStyle(0x1a0d2e, 1); g.fillRoundedRect(laX - 3, laY + armAng * 0.3, 6, 10, 3);
        g.fillStyle(0x6622aa, 1);
        g.fillTriangle(laX - 2, laY + 10 + armAng * 0.3, laX + 1, laY + 8 + armAng * 0.3, laX, laY + 13 + armAng * 0.3);
        const raX = cx + 13, raY = cy - 2;
        g.fillStyle(0x1a0d2e, 1); g.fillRoundedRect(raX - 3, raY - armAng * 0.3, 6, 10, 3);
        g.fillStyle(0x6622aa, 1);
        g.fillTriangle(raX - 2, raY + 10 - armAng * 0.3, raX + 1, raY + 8 - armAng * 0.3, raX, raY + 13 - armAng * 0.3);
        g.fillStyle(0x2a1040, 0.97); g.fillEllipse(cx, cy - 10, 22, 20);
        g.fillStyle(0x4a1880, 1);
        g.fillTriangle(cx - 8, cy - 17, cx - 11, cy - 28, cx - 4, cy - 17);
        g.fillTriangle(cx + 8, cy - 17, cx + 11, cy - 28, cx + 4, cy - 17);
        g.fillStyle(0x8833cc, 0.5);
        g.fillTriangle(cx - 8, cy - 18, cx - 10, cy - 26, cx - 6, cy - 18);
        g.fillTriangle(cx + 8, cy - 18, cx + 10, cy - 26, cx + 6, cy - 18);
        g.fillStyle(0xff4400, 0.35); g.fillCircle(cx - 5, cy - 11, 5); g.fillCircle(cx + 5, cy - 11, 5);
        g.fillStyle(0xff6600, 1);   g.fillCircle(cx - 5, cy - 11, 3.5); g.fillCircle(cx + 5, cy - 11, 3.5);
        g.fillStyle(0x1a0000, 1);   g.fillCircle(cx - 5, cy - 11, 1.8); g.fillCircle(cx + 5, cy - 11, 1.8);
        g.fillStyle(0xffffff, 0.8); g.fillCircle(cx - 4, cy - 12, 0.9); g.fillCircle(cx + 6, cy - 12, 0.9);
        g.fillStyle(0x0d0010, 1); g.fillRoundedRect(cx - 5, cy - 6, 10, 4, 2);
        g.fillStyle(0xddccff, 0.9);
        g.fillTriangle(cx - 4, cy - 6, cx - 2, cy - 6, cx - 3, cy - 3);
        g.fillTriangle(cx,     cy - 6, cx + 2, cy - 6, cx + 1, cy - 3);
        g.lineStyle(1.5, 0x5522aa, 0.55);
        g.strokeEllipse(cx, cy + 2, 26, 22); g.strokeEllipse(cx, cy - 10, 22, 20);
        g.generateTexture('enemy_' + f, 48, 40); g.destroy();
      }

      for (let f = 0; f < 4; f++) {
        const g = this.add.graphics();
        const wingSpread = [14, 18, 12, 8][f];
        g.fillStyle(0x6622aa, 0.9);
        g.fillTriangle(20, 20, 0,  20 - wingSpread, 20, 14);
        g.fillTriangle(20, 20, 40, 20 - wingSpread, 20, 14);
        g.lineStyle(1, 0xaa44ff, 0.6);
        g.strokeTriangle(20, 20, 0,  20 - wingSpread, 20, 14);
        g.strokeTriangle(20, 20, 40, 20 - wingSpread, 20, 14);
        g.fillStyle(0x3a0a5a, 1); g.fillEllipse(20, 18, 18, 14);
        g.fillStyle(0xff2222, 1); g.fillCircle(15, 16, 3); g.fillCircle(25, 16, 3);
        g.fillStyle(0xff8888, 0.8); g.fillCircle(15, 15, 1.5); g.fillCircle(25, 15, 1.5);
        g.generateTexture('flyer_' + f, 40, 32); g.destroy();
      }

      // Counter sprites ? bomb with shortening fuse (0-4) and explosion (5)
      for (let n = 0; n < 6; n++) {
        if (!this.textures.exists('counter_' + n)) {
          const W = 40, H = 48;
          const g = this.add.graphics();

          if (n < 5) {
            // ?? Bomb body ?????????????????????????????????????????????
            const cx = 20, cy = 30, r = 14;

            // Shadow / depth ring
            g.fillStyle(0x000000, 0.35);
            g.fillCircle(cx + 2, cy + 2, r);

            // Main body ? dark iron
            g.fillStyle(0x222222, 1);
            g.fillCircle(cx, cy, r);

            // Shine highlight
            g.fillStyle(0x555555, 0.6);
            g.fillCircle(cx - 4, cy - 5, 5);
            g.fillStyle(0xaaaaaa, 0.25);
            g.fillCircle(cx - 5, cy - 6, 3);

            // Danger indicator ? gets redder as count rises
            const dangerColors = [0x224488, 0x885522, 0xaa4400, 0xcc2200, 0xff0000];
            g.fillStyle(dangerColors[n], 0.85);
            g.fillCircle(cx + 4, cy + 4, 4);

            // Cap on top of bomb
            g.fillStyle(0x333333, 1);
            g.fillRect(cx - 4, cy - r - 4, 8, 6);
            g.fillStyle(0x444444, 1);
            g.fillRect(cx - 3, cy - r - 6, 6, 4);

            // Fuse ? shortens as count increases
            // n=0: long curly fuse; n=4: very short stub
            const fuseStages = [
              // [x1,y1, x2,y2, x3,y3 ...] as zigzag line points
              [cx, cy - r - 6,  cx + 5, cy - r - 12,  cx + 2, cy - r - 18,  cx + 7, cy - r - 24],
              [cx, cy - r - 6,  cx + 5, cy - r - 12,  cx + 2, cy - r - 18],
              [cx, cy - r - 6,  cx + 5, cy - r - 12,  cx + 1, cy - r - 15],
              [cx, cy - r - 6,  cx + 4, cy - r - 10],
              [cx, cy - r - 6,  cx + 2, cy - r - 8],
            ];
            const pts = fuseStages[n];
            g.lineStyle(2, 0x886633, 1);
            g.beginPath();
            g.moveTo(pts[0], pts[1]);
            for (let pi = 2; pi < pts.length; pi += 2) {
              g.lineTo(pts[pi], pts[pi + 1]);
            }
            g.strokePath();

            // Spark at fuse tip ? grows brighter as count rises
            const sparkColors = [0xffee44, 0xffcc22, 0xff8800, 0xff4400, 0xff2200];
            const sparkR = [3, 3, 4, 4, 5];
            const tipX = pts[pts.length - 2];
            const tipY = pts[pts.length - 1];
            g.fillStyle(sparkColors[n], 1);
            g.fillCircle(tipX, tipY, sparkR[n]);
            g.fillStyle(0xffffff, 0.7);
            g.fillCircle(tipX, tipY, 1.5);

          } else {
            // n=5 ? EXPLOSION star burst
            const cx = 20, cy = 24;
            const rays = 12;
            // Outer glow
            g.fillStyle(0xff8800, 0.4);
            g.fillCircle(cx, cy, 18);
            // Mid burst
            g.fillStyle(0xff4400, 0.8);
            g.fillCircle(cx, cy, 12);
            // Bright core
            g.fillStyle(0xffee00, 1);
            g.fillCircle(cx, cy, 7);
            // White hot centre
            g.fillStyle(0xffffff, 1);
            g.fillCircle(cx, cy, 3);
            // Ray spikes
            g.fillStyle(0xff6600, 0.9);
            for (let i = 0; i < rays; i++) {
              const angle = (i / rays) * Math.PI * 2;
              const inner = 10, outer = 18 + (i % 3) * 3;
              const ix = cx + Math.cos(angle) * inner;
              const iy = cy + Math.sin(angle) * inner;
              const ox = cx + Math.cos(angle) * outer;
              const oy = cy + Math.sin(angle) * outer;
              g.lineStyle(2.5, 0xff8800, 0.85);
              g.beginPath(); g.moveTo(ix, iy); g.lineTo(ox, oy); g.strokePath();
            }
          }

          g.generateTexture('counter_' + n, W, H);
          g.destroy();
        }
      }

      if (!this.textures.exists('bullet')) {
        const g = this.add.graphics();
        g.fillStyle(0xff4444, 1); g.fillEllipse(8, 4, 14, 7);
        g.fillStyle(0xffaaaa, 0.7); g.fillEllipse(6, 3, 6, 3);
        g.generateTexture('bullet', 16, 8); g.destroy();
      }
    }

    if (!this.textures.exists('spike')) {
      const g = this.add.graphics();
      g.fillStyle(0xbbbbbb, 1);
      for (let i = 0; i < 4; i++) g.fillTriangle(i*10, 16, i*10+5, 0, i*10+10, 16);
      g.generateTexture('spike', 40, 16); g.destroy();
    }

    const powerupDefs = [
      { key: 'pu_double_jump', color: 0x44aaff },
      { key: 'pu_speed',       color: 0xffaa22 },
      { key: 'pu_heart',       color: 0xff3355 },
    ];
    powerupDefs.forEach(def => {
      if (!this.textures.exists(def.key)) {
        const g = this.add.graphics();
        if (def.key === 'pu_heart') {
          g.fillStyle(0xff3355, 1);
          g.fillCircle(9, 10, 7); g.fillCircle(21, 10, 7);
          g.fillTriangle(2, 13, 28, 13, 15, 28);
          g.fillStyle(0xff7799, 0.6); g.fillCircle(7, 8, 3);
        } else {
          g.fillStyle(def.color, 0.9);
          g.fillRoundedRect(2, 2, 26, 26, 8);
          g.lineStyle(2, 0xffffff, 0.7);
          g.strokeRoundedRect(2, 2, 26, 26, 8);
        }
        g.generateTexture(def.key, 30, 30); g.destroy();
      }
    });

    if (!this.textures.exists('shovel')) {
      const g = this.add.graphics();
      g.fillStyle(0x8b5e2a, 1); g.fillRoundedRect(13, 2, 5, 20, 2);
      g.fillStyle(0xccaa44, 1); g.fillRect(12, 16, 7, 3);
      g.fillStyle(0xf0d060, 1); g.fillTriangle(8, 22, 23, 22, 15, 34); g.fillRect(9, 19, 13, 5);
      g.fillStyle(0xfff0a0, 0.7); g.fillTriangle(11, 22, 17, 22, 13, 29);
      g.generateTexture('shovel', 32, 36); g.destroy();
    }
  }

  createAnimations() {
    if (this.anims.get('player_walk')) return;
    this.anims.create({ key: 'player_walk', frames: [0,1,2,3,4,5].map(f => ({ key:'player_'+f })), frameRate: 12, repeat: -1 });
    this.anims.create({ key: 'player_idle', frames: [{ key: 'player_0' }], frameRate: 1, repeat: -1 });
    this.anims.create({ key: 'firefly_glow', frames: [0,1,2,3].map(f => ({ key:'firefly_'+f })), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'enemy_wobble', frames: [0,1,2,3,2,1].map(f => ({ key:'enemy_'+f })), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'flyer_flap', frames: [0,1,2,3,2,1].map(f => ({ key:'flyer_'+f })), frameRate: 10, repeat: -1 });
  }

  // ?? World building ???????????????????????????????????????????????????????????

  createBackground(lvl) {
    const sky = this.add.graphics().setScrollFactor(0);
    sky.fillGradientStyle(lvl.bgTop, lvl.bgTop, lvl.bgBottom, lvl.bgBottom, 1);
    sky.fillRect(0, 0, VIEW_W, VIEW_H);

    for (let i = 0; i < 70; i++) {
      const x = (i * 137 + 42) % VIEW_W;
      const y = (i * 97  + 17) % (VIEW_H * 0.68);
      const r = (i % 3 === 0) ? 1.5 : 1;
      const star = this.add.circle(x, y, r, 0xf5f0d8, 0.15 + (i%5)*0.07).setScrollFactor(0);
      this.tweens.add({ targets: star, alpha: 0.05, duration: 1200+(i%7)*400, yoyo:true, repeat:-1, delay:(i%11)*180 });
    }

    const moonGlow = this.add.circle(VIEW_W - 100, 68, 68, lvl.moonColor, 0.07).setScrollFactor(0);
    this.tweens.add({ targets: moonGlow, alpha: 0.15, duration: 2800, yoyo:true, repeat:-1 });
    this.add.circle(VIEW_W - 100, 68, 44, lvl.moonColor, 0.92).setScrollFactor(0);

    const layerSpeeds  = [0.05, 0.12, 0.22];
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
  }

  createGround(lvl) {
    const lavaSections = Array.isArray(lvl.lavaFloor) ? lvl.lavaFloor : [];
    this._lavaSections = lavaSections;
    this._createGrassGround(lvl, lavaSections);
    if (lavaSections.length > 0) {
      this._createLavaGround(lvl, lavaSections);
    }
  }

  _createGrassGround(lvl, lavaSections) {
    const g = this.add.graphics();
    // Helper: is x within a lava section?
    const inLava = (x) => lavaSections.some(s => x >= s.x1 && x <= s.x2);

    g.fillStyle(lvl.groundDirt, 1);
    g.fillRect(0, GROUND_Y + 8, WORLD_W, VIEW_H - GROUND_Y);
    g.fillStyle(lvl.groundFill, 1);
    g.fillRect(0, GROUND_Y + 4, WORLD_W, 12);

    // Grass top strip and blades ? skipping lava sections
    g.fillStyle(lvl.groundTop, 1);
    for (let x = 0; x < WORLD_W; x += 2) {
      if (!inLava(x)) g.fillRect(x, GROUND_Y, 2, 8);
    }
    for (let x = 4; x < WORLD_W; x += 8) {
      if (inLava(x)) continue;
      const h = 4 + ((x * 7 + 3) % 6);
      g.fillTriangle(x, GROUND_Y, x + 3, GROUND_Y - h, x + 6, GROUND_Y);
    }
    for (let x = 60; x < WORLD_W; x += 160 + ((x * 11) % 80)) {
      if (inLava(x)) continue;
      const bw = 30 + (x % 40);
      const bh = 18 + (x % 18);
      g.fillStyle(lvl.bushColor, 0.9);
      g.fillEllipse(x, GROUND_Y - bh / 2, bw, bh);
      g.fillEllipse(x + bw * 0.35, GROUND_Y - bh * 0.7, bw * 0.6, bh * 0.7);
      g.fillEllipse(x - bw * 0.3,  GROUND_Y - bh * 0.6, bw * 0.5, bh * 0.6);
    }
    for (let x = 30; x < WORLD_W; x += 90 + ((x * 13) % 60)) {
      if (inLava(x)) continue;
      g.fillStyle(lvl.flowerColor, 0.85);
      g.fillCircle(x, GROUND_Y - 10, 4);
      g.fillStyle(0xffffff, 0.4);
      g.fillCircle(x, GROUND_Y - 10, 2);
    }

    // Cover lava pit areas with a dark base
    lavaSections.forEach(s => {
      g.fillStyle(0x1a0000, 1);
      g.fillRect(s.x1, GROUND_Y, s.x2 - s.x1, VIEW_H - GROUND_Y);
    });
  }

  _createLavaGround(lvl, lavaSections) {
    lavaSections.forEach(s => {
      const pw = s.x2 - s.x1;
      const g = this.add.graphics();

      // Base lava fill
      g.fillStyle(0x3a0500, 1);
      g.fillRect(s.x1, GROUND_Y + 4, pw, 12);

      // Three-pass glowing lava waves
      for (let pass = 0; pass < 3; pass++) {
        const colors = [0xff4400, 0xff6600, 0xff9900];
        const alphas = [1, 0.7, 0.45];
        g.fillStyle(colors[pass], alphas[pass]);
        for (let x = s.x1; x <= s.x2; x += 14) {
          const wave = Math.sin(x * 0.012 + pass * 1.1) * (3 + pass * 2);
          g.fillRect(x, GROUND_Y + wave, 16, 6 - pass);
        }
      }

      // Rock lips at section edges
      g.fillStyle(lvl.groundTop ?? 0x3a6b30, 1);
      g.fillRect(s.x1 - 8, GROUND_Y - 4, 16, 12);
      g.fillRect(s.x2 - 8, GROUND_Y - 4, 16, 12);
      g.fillStyle(0x5a3010, 1);
      g.fillRect(s.x1 - 4, GROUND_Y + 4, 8, 8);
      g.fillRect(s.x2 - 4, GROUND_Y + 4, 8, 8);
    });

    // Animated glow layer shared across all sections
    this._lavaGraphics = this.add.graphics().setDepth(1);
    this._lavaPhase = 0;
    this._lavaLvl = lvl;
  }

  _drawLavaSurface(phase) {
    if (!this._lavaGraphics) return;
    this._lavaGraphics.clear();
    const sections = this._lavaSections || [];
    sections.forEach(s => {
      this._lavaGraphics.fillStyle(0xff6600, 0.25);
      for (let x = s.x1; x < s.x2; x += 24) {
        const wave = Math.sin(x * 0.008 + phase) * 5;
        this._lavaGraphics.fillCircle(x, GROUND_Y - 2 + wave, 6);
      }
      // Glow pockets
      this._lavaGraphics.fillStyle(0xffaa00, 0.18);
      for (let x = s.x1 + 40; x < s.x2; x += 120 + ((x * 7) % 60)) {
        const wave = Math.sin(x * 0.015 + phase * 1.3) * 4;
        this._lavaGraphics.fillCircle(x, GROUND_Y - 4 + wave, 10);
      }
    });
  }

  _drawPlatform(p, colors) {
    const c = colors[p.type];
    const g = this.add.graphics();
    g.fillStyle(c.shadow, 1);
    g.fillRoundedRect(p.x - p.w/2, p.y - p.h/2 + 5, p.w, p.h, 6);
    g.fillStyle(c.top, 1);
    g.fillRoundedRect(p.x - p.w/2, p.y - p.h/2, p.w, p.h - 3, 6);
    g.fillStyle(0xffffff, 0.07);
    g.fillRoundedRect(p.x - p.w/2 + 4, p.y - p.h/2, p.w - 8, 4, 3);
    return g;
  }

  createPlatforms(lvl) {
    this.platforms = this.physics.add.staticGroup();
    const lavaSections = Array.isArray(lvl.lavaFloor) ? lvl.lavaFloor : [];
    this._lavaZones = [];

    // Solid ground physics body (always present)
    const groundH = VIEW_H - GROUND_Y;
    const groundBody = this.add.rectangle(WORLD_W / 2, GROUND_Y + groundH / 2, WORLD_W, groundH)
      .setVisible(false);
    this.platforms.add(groundBody, true);
    groundBody.body.setSize(WORLD_W, groundH);
    groundBody.body.reset(WORLD_W / 2, GROUND_Y + groundH / 2);

    // Per lava section: a thin kill-zone physics sensor at the surface
    lavaSections.forEach(s => {
      const pw = s.x2 - s.x1;
      const cx = (s.x1 + s.x2) / 2;
      const zone = this.add.rectangle(cx, GROUND_Y + 1, pw, 4).setVisible(false);
      this.physics.add.existing(zone, true);
      zone.body.setSize(pw, 4);
      zone.body.reset(cx, GROUND_Y + 1);
      this._lavaZones.push(zone);
    });

    lvl.platforms.forEach(p => {
      this._drawPlatform(p, lvl.platformColors);
      const b = this.add.rectangle(p.x, p.y, p.w, p.h).setVisible(false);
      this.platforms.add(b, true);
      b.body.setSize(p.w, p.h);
      b.body.reset(p.x, p.y);
    });
  }

  createSpikes(lvl) {
    this.spikesGroup = this.physics.add.staticGroup();
    lvl.spikes.forEach(s => {
      const count = Math.floor(s.w / 10);
      for (let i = 0; i < count; i++) {
        const sx = s.x + i * 10 + 5;
        const img = this.add.image(sx, GROUND_Y - 6, 'spike');
        img.setDisplaySize(10, 12);
        img.setTint(0xcc3333);
        const body = this.physics.add.staticImage(sx, GROUND_Y - 4, '__DEFAULT')
          .setVisible(false).setDisplaySize(8, 10).refreshBody();
        this.spikesGroup.add(body);
      }
    });
  }

  createPowerups(lvl) {
    this.powerupsGroup = this.physics.add.staticGroup();
    const keyMap = { double_jump: 'pu_double_jump', speed: 'pu_speed', heart: 'pu_heart' };
    lvl.powerups.forEach(p => {
      const img = this.add.image(p.x, p.y, keyMap[p.type]);
      img.setData('puType', p.type);
      img.setData('baseY', p.y);
      this.physics.add.existing(img, true);
      this.powerupsGroup.add(img);
      this.tweens.add({
        targets: img, y: p.y - 8, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        onUpdate: () => { if (img.body) img.body.reset(img.x, img.y); },
      });
      this.tweens.add({ targets: img, angle: 10, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.powerupList.push(img);
    });
  }

  createCollectibles(lvl) {
    this.fireflies = this.physics.add.group();
    lvl.fireflies.forEach(pos => {
      const ff = this.add.sprite(pos.x, pos.y, 'firefly_0').setOrigin(0.5);
      ff.play('firefly_glow');
      this.fireflies.add(ff);
      this.firefliesTotal++;
      this.physics.add.existing(ff);
      ff.body.setAllowGravity(false);
      ff.body.setCircle(10, 2, 2);
    });
  }

  createShovel(lvl) {
    this.shovel = null;
    if (!lvl.shovel) return;
    const s = this.add.image(lvl.shovel.x, lvl.shovel.y, 'shovel').setOrigin(0.5).setDepth(5);
    this.physics.add.existing(s, true);
    s.body.setSize(22, 30);
    this.tweens.add({
      targets: s, y: lvl.shovel.y - 8,
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: () => { if (s.body) s.body.reset(s.x, s.y); },
    });
    const ring = this.add.circle(lvl.shovel.x, lvl.shovel.y + 10, 14, 0xf0d060, 0.25).setDepth(4);
    this.tweens.add({ targets: ring, alpha: { from: 0.1, to: 0.45 }, scale: { from: 0.85, to: 1.15 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.shovel = s;
  }

  createEnemies(lvl) {
    this.enemies = this.physics.add.group();
    const speedMult = hasMod('fast_enemies') ? 1.4 : hasMod('slow_enemies') ? 0.6 : 1;
    lvl.enemies.forEach(p => {
      const e = this.add.sprite(p.x, p.y, 'enemy_0').setOrigin(0.5);
      e.play('enemy_wobble');
      e.setData({ minX: p.minX, maxX: p.maxX, speed: p.speed * speedMult });
      this.enemies.add(e);
      this.physics.add.existing(e);
      e.body.setAllowGravity(false);
      e.body.setVelocityX(p.speed * speedMult);
      e.body.setSize(26, 26);
      e.body.setOffset(11, 10);
    });
  }

  createFlyingEnemies(lvl) {
    this.flyingEnemies = this.physics.add.group();
    this.bullets       = this.physics.add.group();
    const speedMult = hasMod('fast_enemies') ? 1.4 : hasMod('slow_enemies') ? 0.6 : 1;
    (lvl.flyingEnemies ?? []).forEach(p => {
      const fe = this.add.sprite(p.x, p.y, 'flyer_0').setOrigin(0.5);
      fe.play('flyer_flap');
      fe.setData({
        minX: p.minX, maxX: p.maxX, speed: p.speed * speedMult,
        baseY: p.y, hoverT: Math.random() * Math.PI * 2,
        shootInterval: p.shootInterval ?? 8000,
      });
      this.flyingEnemies.add(fe);
      this.physics.add.existing(fe);
      fe.body.setAllowGravity(false);
      fe.body.setVelocityX(p.speed * speedMult);
      fe.body.setSize(30, 22);
      fe.body.setOffset(5, 5);
      this.time.addEvent({
        delay: p.shootInterval ?? 8000,
        loop: true,
        callback: () => { if (!fe.active || this.gameOver) return; this._flyerShoot(fe); },
      });
    });
  }

  _flyerShoot(fe) {
    if (!this.player.active) return;
    const dx = this.player.x - fe.x;
    const dy = this.player.y - fe.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 600) return;
    const speed = 260;
    const vx = (dx / dist) * speed;
    const vy = (dy / dist) * speed;
    const b = this.add.sprite(fe.x, fe.y + 8, 'bullet').setOrigin(0.5);
    this.bullets.add(b);
    this.physics.add.existing(b);
    b.body.setAllowGravity(false);
    b.body.setVelocity(vx, vy);
    b.body.setSize(12, 6);
    b.setRotation(Math.atan2(vy, vx));
    this.tweens.add({ targets: b, alpha: { from: 1, to: 0.6 }, duration: 200, yoyo: true, repeat: -1 });
    this.time.delayedCall(3000, () => { if (b.active) b.destroy(); });
  }

  createCounters(lvl) {
    (lvl.counters ?? []).forEach(p => {
      const sprite = this.add.image(p.x, p.y, 'counter_0').setOrigin(0.5, 0.75);
      this.tweens.add({
        targets: sprite, scaleX: 1.12, scaleY: 1.12,
        duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      this.counterList.push({
        sprite, count: 0, lastTick: 0,
        chaseSpeed:   p.chaseSpeed   ?? 28,
        proximityR:   p.proximityR   ?? 110,
        tickInterval: p.tickInterval ?? 333,
      });
    });
  }

  createPlayer(lvl) {
    const s = lvl.playerStart;
    this.player = this.add.sprite(s.x, s.y, 'player_0').setOrigin(0.5);
    this.player.play('player_walk');
    this.physics.add.existing(this.player);
    this.player.body.setSize(20, 26);
    this.player.body.setOffset(6, 3);
    this.player.body.setBounce(0.05);
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setMaxVelocityX(340);
    this.player.body.setMaxVelocityY(650);
  }

  // ?? Ambient decorations ??????????????????????????????????????????????????????

  createAmbientDecoration(lvl) {
    const lavaSections = Array.isArray(lvl.lavaFloor) ? lvl.lavaFloor : [];
    const isLava = lavaSections.length > 0;

    // Dust motes ? tiny drifting particles across the whole level
    for (let i = 0; i < 60; i++) {
      const x = (i * 277 + 50) % WORLD_W;
      const y = 80 + ((i * 137) % (GROUND_Y - 100));
      const r = 1 + (i % 3) * 0.5;
      const mote = this.add.circle(x, y, r, isLava ? 0xff8844 : 0xaaffcc, 0.25).setDepth(2);
      const driftX = ((i % 5) - 2) * 15;
      const driftY = ((i % 3) - 1) * 8;
      this.tweens.add({
        targets: mote,
        x: x + driftX, y: y + driftY,
        alpha: { from: 0.05, to: 0.35 },
        duration: 2000 + (i % 7) * 600,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        delay: (i % 13) * 200,
      });
    }

    // Ambient non-collectible fireflies near platforms
    if (!isLava) {
      (lvl.platforms || []).slice(0, 12).forEach((p, i) => {
        const ax = p.x + ((i * 37) % p.w) - p.w / 2 + 10;
        const ay = p.y - 22 - (i % 3) * 12;
        const aff = this.add.circle(ax, ay, 3, 0xffdd44, 0.5).setDepth(3);
        this.tweens.add({
          targets: aff,
          y: ay - 10 + (i % 3) * 4,
          alpha: { from: 0.2, to: 0.7 },
          scale: { from: 0.8, to: 1.3 },
          duration: 800 + i * 120,
          yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
          delay: i * 180,
        });
      });
    }

    // Mushroom spores ? upward drifting circles from mushroom platforms
    if (!isLava) {
      (lvl.platforms || []).filter(p => p.type === 'mushroom').slice(0, 8).forEach((p, i) => {
        for (let s = 0; s < 3; s++) {
          const sx = p.x - p.w / 4 + s * (p.w / 3);
          const spore = this.add.circle(sx, p.y - p.h / 2 - 4, 2, 0xffaabb, 0.6).setDepth(2);
          this.tweens.add({
            targets: spore,
            y: p.y - p.h / 2 - 40 - s * 10,
            alpha: 0,
            x: sx + ((s - 1) * 12),
            duration: 1800 + s * 400 + i * 200,
            repeat: -1,
            ease: 'Sine.easeOut',
            delay: i * 300 + s * 500,
            onRepeat: () => { spore.setAlpha(0.6); spore.y = p.y - p.h / 2 - 4; spore.x = sx; },
          });
        }
      });
    }

    // Crystal sparkles (level 2 / 4 only based on palette)
    if (!isLava && lvl.moonColor === 0xaaddff) {
      for (let i = 0; i < 20; i++) {
        const cx = 200 + (i * 157) % (WORLD_W - 300);
        const cy = 100 + (i * 89) % (GROUND_Y - 150);
        const spark = this.add.circle(cx, cy, 2, 0x88ddff, 0.7).setDepth(3);
        this.tweens.add({
          targets: spark, alpha: { from: 0.1, to: 1 }, scale: { from: 0.5, to: 1.5 },
          duration: 600 + i * 80, yoyo: true, repeat: -1, delay: i * 150,
        });
      }
    }

    // Lava embers ? rising orange sparks
    if (isLava) {
      for (let i = 0; i < 40; i++) {
        const ex = (i * 89 + 30) % WORLD_W;
        const ember = this.add.circle(ex, GROUND_Y - 2, 2.5, 0xff6600, 0.8).setDepth(3);
        this.tweens.add({
          targets: ember,
          y: GROUND_Y - 30 - (i % 5) * 12,
          x: ex + ((i % 3) - 1) * 15,
          alpha: 0,
          duration: 900 + (i % 7) * 200,
          repeat: -1,
          ease: 'Sine.easeOut',
          delay: i * 120,
          onRepeat: () => {
            ember.setAlpha(0.8);
            ember.y = GROUND_Y - 2;
            ember.x = ex;
          },
        });
      }
      // Heat shimmer overlay
      for (let i = 0; i < 15; i++) {
        const hx = (i * 211 + 50) % WORLD_W;
        const heat = this.add.circle(hx, GROUND_Y - 12, 4 + (i % 3) * 2, 0xff3300, 0.1).setDepth(2);
        this.tweens.add({
          targets: heat, alpha: { from: 0.02, to: 0.18 }, scaleX: { from: 0.7, to: 1.4 },
          duration: 500 + i * 90, yoyo: true, repeat: -1, delay: i * 170,
        });
      }
    }
  }

  // ?? Collisions ???????????????????????????????????????????????????????????????

  setupCollisions() {
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);

    // Lava kill zones (per section)
    (this._lavaZones || []).forEach(zone => {
      this.physics.add.overlap(this.player, zone, () => {
        const now = this.time.now;
        if (now - this.lavaKillCooldown < 1200) return;
        this.lavaKillCooldown = now;
        if (!this.isHurt && !this.gameOver) {
          this.cameras.main.flash(200, 255, 60, 0);
          const lvl = LEVELS[this.currentLevel];
          this.player.x = lvl.playerStart.x;
          this.player.y = lvl.playerStart.y;
          this.player.body.setVelocity(0, 0);
          this.hurtPlayer(false);
        }
      });
    });

    this.physics.add.overlap(this.player, this.spikesGroup, () => {
      if (!this.isHurt && !this.gameOver) this.hurtPlayer(true);
    });

    this.physics.add.overlap(this.player, this.powerupsGroup, (_pl, pu) => {
      if (!pu.active) return;
      this.collectPowerup(pu);
    });

    this.physics.add.overlap(this.player, this.fireflies, (_pl, ff) => {
      if (!ff.active) return;
      ff.destroy();
      this.firefliesCollected++;
      this.scene.get('UIScene').updateScore(this.firefliesCollected, this.firefliesTotal);
      const flash = this.add.circle(ff.x, ff.y, 18, 0xffdd44, 0.9);
      this.tweens.add({ targets: flash, alpha: 0, scale: 2.5, duration: 280, onComplete: () => flash.destroy() });
      if (this.firefliesCollected >= this.firefliesTotal) this.winLevel();
    });

    if (this.shovel) {
      this.physics.add.overlap(this.player, this.shovel, () => {
        if (!this.shovel || !this.shovel.active) return;
        this.shovel.destroy();
        this.shovel = null;
        this.scene.get('UIScene').showLockedLevel();
      });
    }

    this.physics.add.overlap(this.player, this.enemies, (_pl, enemy) => {
      if (!enemy.active || this.gameOver) return;
      const fallingOnTop = this.player.body.velocity.y > 50 && this.player.y < enemy.y - 4;
      if (fallingOnTop) {
        enemy.destroy();
        this.player.body.setVelocityY(-400);
      } else if (!this.isHurt) {
        this.hurtPlayer(false);
      }
    });

    this.physics.add.overlap(this.player, this.flyingEnemies, (_pl, fe) => {
      if (!fe.active || this.gameOver) return;
      const fallingOnTop = this.player.body.velocity.y > 30 && this.player.y < fe.y - 8;
      if (fallingOnTop) {
        const puff = this.add.circle(fe.x, fe.y, 18, 0xaa44ff, 0.8);
        this.tweens.add({ targets: puff, alpha: 0, scale: 2.5, duration: 300, onComplete: () => puff.destroy() });
        fe.destroy();
        this.player.body.setVelocityY(-420);
      } else if (!this.isHurt) {
        this.hurtPlayer(false);
      }
    });

    this.physics.add.overlap(this.player, this.bullets, (_pl, bullet) => {
      if (!bullet.active || this.gameOver) return;
      bullet.destroy();
      if (!this.isHurt) this.hurtPlayer(false);
    });
  }

  // ?? Powerups ?????????????????????????????????????????????????????????????????

  collectPowerup(pu) {
    const type = pu.getData('puType');
    pu.destroy();
    const DURATION = 10000;
    const flash = this.add.circle(pu.x, pu.y, 24, 0xffffff, 0.8);
    this.tweens.add({ targets: flash, alpha: 0, scale: 3, duration: 350, onComplete: () => flash.destroy() });
    const uiScene = this.scene.get('UIScene');
    if (type === 'double_jump') {
      this.hasDoubleJump  = true;
      this.doubleJumpUsed = false;
      uiScene.showPowerupIndicator('double_jump', DURATION);
      this.time.delayedCall(DURATION, () => { this.hasDoubleJump = false; });
    } else if (type === 'speed') {
      this.hasSpeed = true;
      uiScene.showPowerupIndicator('speed', DURATION);
      this.time.delayedCall(DURATION, () => { this.hasSpeed = false; });
    } else if (type === 'heart') {
      if (this.playerLives < 5) {
        this.playerLives++;
        uiScene.updateLives(this.playerLives);
      }
      const heartFlash = this.add.circle(pu.x, pu.y, 28, 0xff3355, 0.7);
      this.tweens.add({ targets: heartFlash, alpha: 0, scale: 2.8, duration: 400, onComplete: () => heartFlash.destroy() });
      uiScene.showPowerupIndicator('heart', 1200);
    }
  }

  // ?? Player state ??????????????????????????????????????????????????????????????

  hurtPlayer(fatal) {
    if (this.playerLives <= 0) return;
    this.isHurt = true;
    this.playerLives--;
    this.scene.get('UIScene').updateLives(this.playerLives);
    this.cameras.main.flash(150, fatal ? 220 : 160, 40, 40);
    this.player.body.setVelocity(-80, -280);
    this.tweens.add({
      targets: this.player, alpha: 0.4, duration: 100, yoyo: true, repeat: 5,
      onComplete: () => {
        this.player.setAlpha(1);
        this.isHurt = false;
        if (this.playerLives <= 0) this.loseGame();
      }
    });
  }

  winLevel() {
    this.gameOver = true;
    this.physics.pause();
    const next = this.currentLevel + 1;
    if (next < LEVELS.length) {
      // Show modifier picker before advancing
      this.scene.setVisible(false, 'UIScene');
      this.scene.launch('ModifierScene', {
        nextLevel: next,
        lives: this.playerLives,
      });
    } else {
      this.scene.get('UIScene').showVictory();
    }
  }

  loseGame() {
    this.gameOver = true;
    this.physics.pause();
    this.scene.get('UIScene').showGameOver();
  }

  // ?? Update ????????????????????????????????????????????????????????????????????

  update(time, delta) {
    if (this.gameOver || !this.player.active) return;

    // Animate lava surface
    if (this._lavaGraphics) {
      this._lavaPhase += delta * 0.002;
      this._drawLavaSurface(this._lavaPhase);
    }

    // Speed run countdown
    if (hasMod('speed_run')) {
      this._speedRunTime += delta;
      const remaining = Math.max(0, this._speedRunLimit - this._speedRunTime);
      this.scene.get('UIScene').updateSpeedRun(remaining);
      if (remaining <= 0 && !this.gameOver) {
        this.loseGame();
        return;
      }
    }

    const baseSpeed = this.hasSpeed ? 320 : 220;
    const onGround  = this.player.body.blocked.down;
    if (onGround) this.doubleJumpUsed = false;

    const goLeft  = this.cursors.left.isDown  || this.wasd.left.isDown  || mobileInput.left;
    const goRight = this.cursors.right.isDown || this.wasd.right.isDown || mobileInput.right;
    const jumpBtn = this.cursors.up.isDown    || this.wasd.up.isDown    || mobileInput.jump;
    const jumpJustDown = Phaser.Input.Keyboard.JustDown(this.cursors.up)
                      || Phaser.Input.Keyboard.JustDown(this.wasd.up)
                      || mobileInput._jumpJustDown;
    mobileInput._jumpJustDown = false;

    // Slippery ground modifier ? reduce deceleration
    const friction = hasMod('slippery_ground') ? 0.88 : 0;

    if (goLeft) {
      this.player.body.setVelocityX(-baseSpeed);
      this.player.setFlipX(true);
      this.player.play('player_walk', true);
    } else if (goRight) {
      this.player.body.setVelocityX(baseSpeed);
      this.player.setFlipX(false);
      this.player.play('player_walk', true);
    } else {
      if (hasMod('slippery_ground')) {
        this.player.body.setVelocityX(this.player.body.velocity.x * friction);
      } else {
        this.player.body.setVelocityX(0);
      }
      if (onGround) this.player.play('player_idle', true);
    }

    // Jump velocity with modifier
    const jumpV   = hasMod('reduced_jump') ? -368 : hasMod('high_jump') ? -575 : -460;
    const dJumpV  = hasMod('reduced_jump') ? -344 : hasMod('high_jump') ? -537 : -430;
    const cutV    = hasMod('reduced_jump') ? -144 : hasMod('high_jump') ? -225 : -180;

    if (jumpJustDown) {
      if (onGround) {
        this.player.body.setVelocityY(jumpV);
        this._jumpHoldTime = 0;
        this._jumpHolding  = true;
      } else if (this.hasDoubleJump && !this.doubleJumpUsed) {
        this.doubleJumpUsed = true;
        this.player.body.setVelocityY(dJumpV);
        this._jumpHolding = false;
        const puff = this.add.circle(this.player.x, this.player.y + 20, 10, 0x44aaff, 0.7);
        this.tweens.add({ targets: puff, alpha: 0, scale: 2.2, duration: 250, onComplete: () => puff.destroy() });
      }
    }

    if (this._jumpHolding) {
      if (!jumpBtn) {
        this._jumpHolding = false;
        if (this.player.body.velocity.y < cutV) {
          this.player.body.setVelocityY(cutV);
        }
      } else {
        this._jumpHoldTime += delta;
        if (this._jumpHoldTime >= 280) this._jumpHolding = false;
      }
    }

    // Enemy patrol
    this.enemies.getChildren().forEach(e => {
      if (!e.active || !e.body) return;
      const minX = e.getData('minX'), maxX = e.getData('maxX'), spd = e.getData('speed');
      const vx = e.body.velocity.x;
      if (e.x <= minX && vx <= 0) { e.body.setVelocityX(spd);  e.setFlipX(false); }
      if (e.x >= maxX && vx >= 0) { e.body.setVelocityX(-spd); e.setFlipX(true);  }
    });

    // Flying enemy patrol
    const t = this.time.now / 1000;
    this.flyingEnemies.getChildren().forEach(fe => {
      if (!fe.active || !fe.body) return;
      const minX = fe.getData('minX'), maxX = fe.getData('maxX'), spd = fe.getData('speed');
      const baseY = fe.getData('baseY'), hoverT = fe.getData('hoverT');
      const vx = fe.body.velocity.x;
      if (fe.x <= minX && vx <= 0) { fe.body.setVelocityX(spd);  fe.setFlipX(false); }
      if (fe.x >= maxX && vx >= 0) { fe.body.setVelocityX(-spd); fe.setFlipX(true);  }
      fe.y = baseY + Math.sin(t * 2.2 + hoverT) * 18;
    });

    // Counter logic
    const now = this.time.now;
    const deadCounters = [];
    this.counterList.forEach(c => {
      if (!c.sprite.active) return;
      const dx = this.player.x - c.sprite.x;
      const dy = this.player.y - c.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 2) {
        c.sprite.x += (dx / dist) * c.chaseSpeed * (delta / 1000);
        c.sprite.y += (dy / dist) * c.chaseSpeed * (delta / 1000);
      }
      if (dist < c.proximityR && now - c.lastTick >= c.tickInterval && !this.isHurt) {
        c.lastTick = now;
        c.count = Math.min(5, c.count + 1);
        c.sprite.setTexture('counter_' + c.count);
        this.tweens.add({ targets: c.sprite, scaleX: 1.5, scaleY: 1.5, duration: 80, yoyo: true, ease: 'Power2' });
        if (c.count >= 5) {
          const ex = this.add.circle(c.sprite.x, c.sprite.y, 40, 0x5500ff, 0.8);
          this.tweens.add({ targets: ex, alpha: 0, scale: 3, duration: 450, onComplete: () => ex.destroy() });
          c.sprite.destroy();
          deadCounters.push(c);
          if (!this.isHurt && !this.gameOver) this.hurtPlayer(false);
        }
      }
    });
    deadCounters.forEach(c => {
      const idx = this.counterList.indexOf(c);
      if (idx !== -1) this.counterList.splice(idx, 1);
    });

    this.bullets.getChildren().forEach(b => {
      if (b.active && (b.x < -50 || b.x > WORLD_W + 50 || b.y < -50 || b.y > VIEW_H + 50)) b.destroy();
    });
  }
}

// ??? Modifier Scene ???????????????????????????????????????????????????????????

class ModifierScene extends Phaser.Scene {
  constructor() { super({ key: 'ModifierScene' }); }

  init(data) {
    this.nextLevel = data.nextLevel;
    this.lives     = data.lives;
  }

  create() {
    const W = VIEW_W, H = VIEW_H;

    // Dim overlay
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.75).setScrollFactor(0);

    this.add.text(W / 2, 60, T('mod_pick_title'), {
      fontSize: '28px', fontFamily: 'Georgia', color: '#ffeeaa',
    }).setOrigin(0.5);

    this.add.text(W / 2, 100, T('mod_pick_sub'), {
      fontSize: '14px', fontFamily: 'Georgia', color: '#aabb88',
    }).setOrigin(0.5);

    // Pick 3 random modifiers (exclude already active)
    const pool = MODIFIERS_DATA.filter(m => !window.activeModifiers.includes(m.id));
    const picks = [];
    const used  = new Set();
    while (picks.length < 3 && picks.length < pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      if (!used.has(idx)) { used.add(idx); picks.push(pool[idx]); }
    }
    // If pool is exhausted, allow repeats (shouldn't normally happen with 8 mods)
    while (picks.length < 3) picks.push(MODIFIERS_DATA[picks.length % MODIFIERS_DATA.length]);

    const cardW = 200, cardH = 230, gap = 24;
    const totalW = picks.length * cardW + (picks.length - 1) * gap;
    const startX = (W - totalW) / 2;

    picks.forEach((mod, i) => {
      const cx = startX + i * (cardW + gap);
      const cy = 160;

      const catColors = { harder: 0xdd3333, easier: 0x33bb66, twist: 0x3388ff };
      const catColor  = catColors[mod.category] || 0x888888;
      const catHex    = '#' + catColor.toString(16).padStart(6, '0');

      // Card background
      const card = this.add.rectangle(cx + cardW/2, cy + cardH/2, cardW, cardH, 0x0a1628, 1)
        .setStrokeStyle(2, catColor);

      // Icon (drawn with graphics)
      this._drawModIcon(cx + cardW/2, cy + 50, mod.icon, catColor);

      // Title
      this.add.text(cx + cardW/2, cy + 100, T(mod.label_key), {
        fontSize: '15px', fontFamily: 'Georgia', color: catHex,
        wordWrap: { width: cardW - 20 }, align: 'center',
      }).setOrigin(0.5, 0);

      // Description
      this.add.text(cx + cardW/2, cy + 130, T(mod.desc_key), {
        fontSize: '12px', fontFamily: 'Georgia', color: '#99aacc',
        wordWrap: { width: cardW - 20 }, align: 'center',
      }).setOrigin(0.5, 0);

      // Category label
      this.add.text(cx + cardW/2, cy + cardH - 30, mod.category.toUpperCase(), {
        fontSize: '10px', fontFamily: 'Georgia', color: catHex,
        letterSpacing: 2,
      }).setOrigin(0.5, 0);

      // Click zone
      const zone = this.add.rectangle(cx + cardW/2, cy + cardH/2, cardW, cardH, 0xffffff, 0)
        .setInteractive({ useHandCursor: true });

      zone.on('pointerover', () => card.setFillStyle(0x162840));
      zone.on('pointerout',  () => card.setFillStyle(0x0a1628));
      zone.on('pointerdown', () => this._selectModifier(mod));
    });

    // Skip option
    const skipText = this.add.text(W / 2, H - 50, '? ' + T('mod_pick_title') + ' ?', {
      fontSize: '13px', fontFamily: 'Georgia', color: '#556655',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    skipText.setText('? Skip ?');
    skipText.on('pointerover', () => skipText.setColor('#88aa88'));
    skipText.on('pointerout',  () => skipText.setColor('#556655'));
    skipText.on('pointerdown', () => this._advance());
  }

  _drawModIcon(cx, cy, icon, color) {
    const g = this.add.graphics();
    g.fillStyle(color, 0.25); g.fillCircle(cx, cy, 28);
    g.lineStyle(2, color, 0.7); g.strokeCircle(cx, cy, 28);
    g.fillStyle(color, 0.9);
    switch (icon) {
      case 'sword':
        g.fillRect(cx - 2, cy - 18, 4, 30); g.fillRect(cx - 10, cy - 4, 20, 4); break;
      case 'snail':
        g.fillCircle(cx, cy + 4, 12); g.fillRect(cx - 14, cy + 6, 8, 6); break;
      case 'heart':
        g.fillCircle(cx - 5, cy, 9); g.fillCircle(cx + 5, cy, 9);
        g.fillTriangle(cx - 13, cy + 4, cx + 13, cy + 4, cx, cy + 18); break;
      case 'down':
        g.fillTriangle(cx, cy + 16, cx - 12, cy - 4, cx + 12, cy - 4); break;
      case 'up':
        g.fillTriangle(cx, cy - 16, cx - 12, cy + 4, cx + 12, cy + 4); break;
      case 'clock':
        g.strokeCircle(cx, cy, 16);
        g.fillRect(cx - 1, cy - 12, 2, 13); g.fillRect(cx, cy - 1, 10, 2); break;
      case 'flip':
        g.fillTriangle(cx, cy - 16, cx - 12, cy, cx + 12, cy);
        g.fillTriangle(cx, cy + 16, cx - 12, cy, cx + 12, cy); break;
      case 'ice':
        g.fillRect(cx - 16, cy - 2, 32, 4);
        g.fillRect(cx - 2, cy - 16, 4, 32);
        g.fillRect(cx - 12, cy - 12, 4, 4); g.fillRect(cx + 8, cy - 12, 4, 4);
        g.fillRect(cx - 12, cy + 8, 4, 4);  g.fillRect(cx + 8, cy + 8, 4, 4); break;
    }
    g.destroy();
  }

  _selectModifier(mod) {
    if (!window.activeModifiers.includes(mod.id)) {
      window.activeModifiers.push(mod.id);
    }
    // apply extra_life immediately (lives bump)
    if (mod.id === 'extra_life') this.lives = Math.min(5, this.lives + 1);
    this._advance();
  }

  _advance() {
    const next  = this.nextLevel;
    const lives = this.lives;
    this.scene.stop();
    this.scene.setVisible(true, 'UIScene');
    this.scene.get('UIScene').scene.restart({ level: next, lives });
    this.scene.get('GameScene').scene.restart({ level: next, lives });
  }
}

// ??? UI Scene ?????????????????????????????????????????????????????????????????

class UIScene extends Phaser.Scene {
  constructor() { super({ key: 'UIScene' }); }

  init(data) {
    this.currentLevel = (data && data.level != null) ? data.level : 0;
    this.playerLives  = (data && data.lives  != null) ? data.lives  : 3;
  }

  create() {
    const W   = VIEW_W;
    const lvl = LEVELS[this.currentLevel];

    this.fireflyText = this.add.text(16, 16, T('hud_fireflies', 0, 0), {
      fontSize: '17px', fontFamily: 'Georgia', color: '#aaffaa'
    });
    this.livesText = this.add.text(W - 16, 16, '\u2665'.repeat(this.playerLives), {
      fontSize: '20px', fontFamily: 'Georgia', color: '#ff8888'
    }).setOrigin(1, 0);

    this.titleText = this.add.text(W/2, 16, T('hud_title'), {
      fontSize: '19px', fontFamily: 'Georgia', color: '#88ee88', fontStyle: 'italic'
    }).setOrigin(0.5, 0);

    this.levelText = this.add.text(W/2, 38, T('hud_level', this.currentLevel + 1, lvl.name), {
      fontSize: '12px', fontFamily: 'Georgia', color: '#99aacc'
    }).setOrigin(0.5, 0);

    this.controlsText = this.add.text(W/2, 574, T('hud_controls'), {
      fontSize: '12px', fontFamily: 'Georgia', color: '#446644'
    }).setOrigin(0.5, 0);

    // Speed run timer text (only shows when modifier active)
    this.speedRunText = this.add.text(W/2, 56, '', {
      fontSize: '15px', fontFamily: 'Georgia', color: '#ffaa22'
    }).setOrigin(0.5, 0).setVisible(hasMod('speed_run'));

    // Active modifiers badge
    if (window.activeModifiers.length > 0) {
      this.modBadge = this.add.text(16, VIEW_H - 20, window.activeModifiers.map(m => {
        const def = MODIFIERS_DATA.find(d => d.id === m);
        return def ? T(def.label_key) : m;
      }).join(' \u00b7 '), {
        fontSize: '10px', fontFamily: 'Georgia', color: '#557755'
      });
    }

    this.puBar   = this.add.container(14, 545);
    this.overlay = this.add.container(W/2, 280).setVisible(false);

    this.input.keyboard.on('keydown-R', () => {
      this.overlay.setVisible(false);
      window.activeModifiers = [];
      this.scene.get('GameScene').scene.restart({ level: 0, lives: 3 });
      this.scene.restart({ level: 0, lives: 3 });
    });
  }

  refreshLanguage() {
    // Update all live text objects to the current language
    const lvl = LEVELS[this.currentLevel];
    if (this.fireflyText)  this.fireflyText.setText(T('hud_fireflies', this.scene.get('GameScene')?.firefliesCollected ?? 0, this.scene.get('GameScene')?.firefliesTotal ?? 0));
    if (this.titleText)    this.titleText.setText(T('hud_title'));
    if (this.levelText)    this.levelText.setText(T('hud_level', this.currentLevel + 1, lvl.name));
    if (this.controlsText) this.controlsText.setText(T('hud_controls'));
    if (this.modBadge) {
      this.modBadge.setText(window.activeModifiers.map(m => {
        const def = MODIFIERS_DATA.find(d => d.id === m);
        return def ? T(def.label_key) : m;
      }).join(' \u00b7 '));
    }
  }

  showPowerupIndicator(type, duration) {
    this.puBar.removeAll(true);
    const colors = { double_jump: '#44aaff', speed: '#ffaa22', heart: '#ff3355' };
    const color  = colors[type];
    const label  = T('pu_' + type);
    const bg  = this.add.rectangle(0, 0, 130, 22, 0x000000, 0.55).setOrigin(0, 0.5);
    const bar = this.add.rectangle(2, 0, 126, 14, Phaser.Display.Color.HexStringToColor(color).color, 0.85).setOrigin(0, 0.5);
    const txt = this.add.text(65, 0, label, { fontSize: '11px', fontFamily: 'Georgia', color }).setOrigin(0.5, 0.5);
    this.puBar.add([bg, bar, txt]);
    this.tweens.add({
      targets: bar, displayWidth: 0, duration,
      onComplete: () => this.puBar.removeAll(true)
    });
  }

  updateSpeedRun(ms) {
    if (!this.speedRunText) return;
    this.speedRunText.setVisible(true);
    const secs = Math.ceil(ms / 1000);
    this.speedRunText.setText('\u23f1 ' + secs + 's');
    this.speedRunText.setColor(secs <= 10 ? '#ff4444' : '#ffaa22');
  }

  _showOverlay(title, titleColor, sub, subColor, borderColor) {
    this.overlay.removeAll(true);
    const bg = this.add.rectangle(0, 0, 480, 170, 0x060d1a, 0.93);
    bg.setStrokeStyle(2, borderColor);
    this.overlay.add([
      bg,
      this.add.text(0, -35, title, { fontSize: '22px', fontFamily: 'Georgia', color: titleColor }).setOrigin(0.5),
      this.add.text(0, 22, sub, { fontSize: '15px', fontFamily: 'Georgia', color: subColor }).setOrigin(0.5),
    ]);
    this.overlay.setVisible(true);
  }

  showLevelComplete(nextName, cb) {
    this._showOverlay(T('overlay_level_complete_title'), '#aaffaa', T('overlay_level_complete_sub', nextName), '#88dd88', 0x66dd66);
    this.time.delayedCall(2200, cb);
  }
  showVictory() {
    this._showOverlay(T('overlay_victory_title'), '#ffeeaa', T('overlay_victory_sub'), '#ccbb88', 0xddbb44);
  }
  showLockedLevel() {
    this._showOverlay(T('overlay_locked_title'), '#f0d060', T('overlay_locked_sub'), '#ccaa44', 0xb08820);
  }
  showGameOver() {
    this._showOverlay(T('overlay_gameover_title'), '#ff9999', T('overlay_gameover_sub'), '#cc7777', 0xdd5555);
  }

  updateScore(collected, total) {
    this.fireflyText.setText(T('hud_fireflies', collected, total));
  }
  updateLives(lives) {
    this.livesText.setText('\u2665'.repeat(Math.max(0, lives)));
  }
}

// ??? Phaser configuration ?????????????????????????????????????????????????????

if (typeof EDITOR_MODE === 'undefined') {
  Promise.all([
    fetch('levels.json').then(r => r.json()),
    fetch('i18n.json').then(r => r.json()),
    fetch('modifiers.json').then(r => r.json()),
  ]).then(([levelsData, i18nData, modData]) => {
    LEVELS         = levelsData;
    I18N_DATA      = i18nData;
    MODIFIERS_DATA = modData;

    // Expose globals for HTML-side code (admin panel, mobile controls)
    window.LEVELS      = LEVELS;
    window.T           = T;
    window.mobileInput = mobileInput;

    // Restore language preference
    window.LANG = localStorage.getItem('mm_lang') || 'nl';

    new Phaser.Game({
      type: Phaser.CANVAS,
      width: VIEW_W,
      height: VIEW_H,
      parent: 'game-container',
      backgroundColor: '#060d1a',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: 'arcade',
        arcade: { gravity: { y: 750 }, debug: false }
      },
      scene: [GameScene, UIScene, ModifierScene]
    });
  }).catch(err => console.error('Failed to load game data:', err));
}

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
if (!window.fireflyBank)     window.fireflyBank     = 0; // carried-over fireflies
let MODIFIERS_DATA = [];

function countMod(id) { return window.activeModifiers.filter(m => m === id).length; }
function hasMod(id)   { return countMod(id) > 0; }

// ??? Mobile input bridge ??????????????????????????????????????????????????????
const mobileInput = { left: false, right: false, jump: false, axisX: 0 };

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
    this._halfHurt          = false;
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

    // Apply extra_life modifier (each stack = +1 life)
    this.playerLives = Math.min(5, this.playerLives + countMod('extra_life'));
    this._investmentLives = this.playerLives; // snapshot for investment check

    const _saved = localStorage.getItem('mm_level_' + this.currentLevel);
    let lvl = _saved
      ? { ...LEVELS[this.currentLevel], ...JSON.parse(_saved) }
      : LEVELS[this.currentLevel];

    // early_lava: inject extra lava pits before building the world
    if (hasMod('early_lava')) {
      const existing = Array.isArray(lvl.lavaFloor) ? lvl.lavaFloor : [];
      const extras   = Array.from({ length: countMod('early_lava') }, (_, i) => ({
        x1: 600 + i * 800, x2: 750 + i * 800,
      }));
      lvl = { ...lvl, lavaFloor: [...existing, ...extras] };
    }

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
    this.createExitPortal(lvl);
    this.createEnemies(lvl);
    this.createFlyingEnemies(lvl);
    this.createCounters(lvl);
    this.createPlayer(lvl);
    this.createAmbientDecoration(lvl);
    this.createStalagmites(lvl);
    this.setupCollisions();
    this.createSleeperEntity();
    this.createFlashbangEffect();

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

    if (!this.textures.exists('stalactite')) {
      const g = this.add.graphics();
      g.fillStyle(0x7a6a58, 1);
      g.fillTriangle(0, 0, 20, 0, 10, 58);
      g.fillStyle(0x9a8878, 0.55);
      g.fillTriangle(1, 0, 8, 0, 4, 36);
      g.fillStyle(0x4a3a2a, 1);
      g.fillTriangle(6, 42, 14, 42, 10, 58);
      g.fillStyle(0xc0a888, 0.25);
      g.fillTriangle(3, 0, 7, 0, 4, 22);
      g.generateTexture('stalactite', 20, 58);
      g.destroy();
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

    const layerSpeeds = [0.05, 0.12, 0.22];

    if (lvl.isCave) {
      // Glowing crystal specks on ceiling instead of stars
      for (let i = 0; i < 55; i++) {
        const x = (i * 137 + 42) % VIEW_W;
        const y = (i * 97  + 17) % (VIEW_H * 0.55);
        const r = (i % 4 === 0) ? 2 : 1;
        const speck = this.add.circle(x, y, r, lvl.moonColor, 0.08 + (i%5)*0.04).setScrollFactor(0);
        this.tweens.add({ targets: speck, alpha: 0.02, duration: 1400+(i%7)*400, yoyo:true, repeat:-1, delay:(i%11)*180 });
      }

      // Crystal accent in corner instead of moon
      const cx = VIEW_W - 90, cy = 55;
      this.add.circle(cx, cy, 36, lvl.moonColor, 0.04).setScrollFactor(0);
      const crystalGlow = this.add.circle(cx, cy, 22, lvl.moonColor, 0.5).setScrollFactor(0);
      this.tweens.add({ targets: crystalGlow, alpha: 0.7, duration: 2800, yoyo:true, repeat:-1 });

      // Parallax stalactite formations hanging from the ceiling
      const stalHeights = [130, 100, 75];
      lvl.paralaxTrees.forEach((color, li) => {
        const g = this.add.graphics().setScrollFactor(layerSpeeds[li]);
        g.fillStyle(color, 1);
        for (let t = 0; t < Math.ceil(WORLD_W / 70) + 2; t++) {
          const tx = t * 68 + (li * 22);
          const th = stalHeights[li] + ((t * 37 + li * 13) % 40);
          // Stalactites hang DOWN from y=0
          g.fillTriangle(tx, 0, tx + 32, 0, tx + 16, th);
        }
      });
    } else {
      // Stars
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
    const inLava = (x) => lavaSections.some(s => x >= s.x1 && x <= s.x2);

    g.fillStyle(lvl.groundDirt, 1);
    g.fillRect(0, GROUND_Y + 8, WORLD_W, VIEW_H - GROUND_Y);
    g.fillStyle(lvl.groundFill, 1);
    g.fillRect(0, GROUND_Y + 4, WORLD_W, 12);

    if (lvl.isCave) {
      // Rocky/jagged cave floor surface
      g.fillStyle(lvl.groundTop, 1);
      for (let x = 0; x < WORLD_W; x += 2) {
        if (!inLava(x)) g.fillRect(x, GROUND_Y, 2, 8);
      }
      // Jagged rock teeth on floor
      for (let x = 6; x < WORLD_W; x += 14 + ((x * 5) % 10)) {
        if (inLava(x)) continue;
        const h = 3 + ((x * 11 + 7) % 7);
        g.fillStyle(lvl.groundTop, 0.85);
        g.fillTriangle(x, GROUND_Y, x + 5, GROUND_Y - h, x + 10, GROUND_Y);
      }
      // Rock clusters near ground
      for (let x = 80; x < WORLD_W; x += 140 + ((x * 11) % 90)) {
        if (inLava(x)) continue;
        const rw = 18 + (x % 22);
        const rh = 10 + (x % 12);
        g.fillStyle(lvl.bushColor, 0.85);
        g.fillEllipse(x, GROUND_Y - rh * 0.4, rw, rh);
        g.fillEllipse(x + rw * 0.4, GROUND_Y - rh * 0.3, rw * 0.5, rh * 0.55);
      }
      // Crystal formations
      for (let x = 40; x < WORLD_W; x += 110 + ((x * 17) % 70)) {
        if (inLava(x)) continue;
        g.fillStyle(lvl.flowerColor, 0.6);
        const ch = 6 + (x % 9);
        g.fillTriangle(x - 3, GROUND_Y, x + 3, GROUND_Y, x, GROUND_Y - ch);
        g.fillTriangle(x + 5, GROUND_Y, x + 10, GROUND_Y, x + 7, GROUND_Y - ch * 0.7);
      }
    } else {
      // Grass top strip and blades
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

  createExitPortal(lvl) {
    const px = lvl.exitX ?? (WORLD_W - 80);
    const py = GROUND_Y - 40;

    if (lvl.exitType === 'shovel') {
      // Shovel exit: use the shovel sprite with golden glow
      const s = this.add.image(px, py + 4, 'shovel').setOrigin(0.5).setDepth(5).setScale(1.6);
      this.tweens.add({
        targets: s, y: py - 10,
        duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      const ring = this.add.circle(px, py + 16, 22, 0xf0d060, 0.2).setDepth(4);
      this.tweens.add({
        targets: ring, alpha: { from: 0.08, to: 0.5 }, scale: { from: 0.8, to: 1.2 },
        duration: 1000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      for (let i = 0; i < 5; i++) {
        const spark = this.add.circle(
          px + Phaser.Math.Between(-14, 14),
          py + Phaser.Math.Between(-22, 18),
          Phaser.Math.Between(2, 4), 0xf0d060, 0.8
        ).setDepth(5);
        this.tweens.add({
          targets: spark, alpha: 0, y: spark.y - Phaser.Math.Between(16, 40),
          duration: Phaser.Math.Between(700, 1400), delay: Phaser.Math.Between(0, 1000),
          repeat: -1, yoyo: false,
          onRepeat: () => {
            spark.x = px + Phaser.Math.Between(-14, 14);
            spark.y = py + Phaser.Math.Between(-8, 18);
            spark.alpha = 0.8;
          },
        });
      }
      this.add.text(px, py - 54, T('hud_exit') || 'EXIT', {
        fontSize: '12px', fontFamily: 'Georgia', color: '#f0d060',
      }).setOrigin(0.5).setDepth(5);
    } else {
      // Glowing portal
      const g = this.add.graphics().setDepth(4);
      const drawPortal = (phase) => {
        g.clear();
        const glow = 0.18 + Math.sin(phase) * 0.10;
        g.fillStyle(0x44ffcc, glow);
        g.fillEllipse(px, py, 52, 72);
        g.lineStyle(3, 0x88ffee, 0.7 + Math.sin(phase) * 0.3);
        g.strokeEllipse(px, py, 52, 72);
        g.lineStyle(2, 0xffffff, 0.4);
        g.strokeEllipse(px, py, 38, 56);
      };
      drawPortal(0);
      let phase = 0;
      this._portalTimer = this.time.addEvent({
        delay: 30, loop: true,
        callback: () => { phase += 0.08; drawPortal(phase); },
      });
      for (let i = 0; i < 6; i++) {
        const spark = this.add.circle(
          px + Phaser.Math.Between(-18, 18),
          py + Phaser.Math.Between(-28, 28),
          Phaser.Math.Between(2, 5), 0x88ffee, 0.8
        ).setDepth(5);
        this.tweens.add({
          targets: spark, alpha: 0, y: spark.y - Phaser.Math.Between(20, 50),
          duration: Phaser.Math.Between(800, 1600), delay: Phaser.Math.Between(0, 1200),
          repeat: -1, yoyo: false,
          onRepeat: () => {
            spark.x = px + Phaser.Math.Between(-18, 18);
            spark.y = py + Phaser.Math.Between(-10, 28);
            spark.alpha = 0.8;
          },
        });
      }
      this.add.text(px, py - 50, T('hud_exit') || 'EXIT', {
        fontSize: '12px', fontFamily: 'Georgia', color: '#88ffee', alpha: 0.8,
      }).setOrigin(0.5).setDepth(5);
    }

    // Physics sensor (same regardless of visual)
    const sensor = this.add.rectangle(px, py, 40, 60).setVisible(false).setDepth(4);
    this.physics.add.existing(sensor, true);
    this.exitPortalSensor = sensor;
  }

  createStalagmites(lvl) {
    // Always create the group so setupCollisions can reference it safely
    this._stalagmiteGroup = this.physics.add.group();
    if (!lvl.stalagmites || !lvl.stalagmites.length) return;

    // Draw static decorative ceiling stalactites at each drop point
    const ceilG = this.add.graphics().setDepth(3);
    lvl.stalagmites.forEach(s => {
      const w = 18 + ((s.x * 7 + 11) % 14);
      const h = 28 + ((s.x * 11 + 7) % 28);
      ceilG.fillStyle(0x5a4a38, 1);
      ceilG.fillTriangle(s.x - w / 2, 0, s.x + w / 2, 0, s.x, h);
      ceilG.fillStyle(0x7a6a58, 0.45);
      ceilG.fillTriangle(s.x - w * 0.28, 0, s.x + w * 0.05, 0, s.x - w * 0.08, h * 0.55);
    });

    // Track which positions haven't been used yet
    const pending = lvl.stalagmites.map(s => ({ x: s.x, dropped: false }));

    // Expose pending list so update() can check proximity
    this._stalPending = pending;

    this._stalDrop = (target) => {
      target.dropped = true;
      if (window.SoundManager) SoundManager.sfxStalagmiteWarning();
      const spr = this.physics.add.image(target.x, -280, 'stalactite')
        .setOrigin(0.5, 0).setDepth(6);
      spr.body.setAllowGravity(true);
      spr.body.setGravityY(2200);
      spr.body.setVelocityY(350);
      spr.body.setSize(14, 52);
      spr.body.setOffset(3, 3);
      this._stalagmiteGroup.add(spr);
    };
  }

  createFlashbangEffect() {
    if (!hasMod('flashbang')) return;

    // Epilepsy warning banner
    const warnBg = this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, 64, 0xcc2200, 0.92)
      .setScrollFactor(0).setDepth(1002);
    const warnTxt = this.add.text(VIEW_W / 2, VIEW_H / 2, '⚠  ' + T('mod_flashbang_desc'), {
      fontSize: '13px', fontFamily: 'Georgia, serif', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1003);
    this.time.delayedCall(3500, () => { warnBg.destroy(); warnTxt.destroy(); });

    // Full-screen overlay used for rapid flashes
    const overlay = this.add.rectangle(VIEW_W / 2, VIEW_H / 2, VIEW_W, VIEW_H, 0xffffff, 0)
      .setScrollFactor(0).setDepth(996);

    const _runSequence = () => {
      if (this.gameOver) return;
      const totalFlips = 8 + countMod('flashbang') * 4;
      let step = 0;
      const doStep = () => {
        if (step >= totalFlips) {
          overlay.setFillStyle(0xffffff, 0);
          const next = Phaser.Math.Between(7000, 14000);
          this.time.delayedCall(next, _runSequence);
          return;
        }
        const bright = step % 2 === 0;
        overlay.setFillStyle(bright ? 0xffffff : 0x000000, bright ? 0.88 : 0.78);
        step++;
        this.time.delayedCall(65, doStep);
      };
      doStep();
    };

    const firstDelay = Phaser.Math.Between(8000, 14000);
    this.time.delayedCall(firstDelay, _runSequence);
  }

  createSleeperEntity() {
    this._sleeperAwake   = false;
    this._sleeperHurtAt  = -9999;

    if (!hasMod('sleeper')) return;

    const SX = 46, SY = 52, R = 22;
    const lerpColor = (r0, g0, b0, r1, g1, b1, t) =>
      (((r0 + (r1 - r0) * t) | 0) << 16) |
      (((g0 + (g1 - g0) * t) | 0) << 8)  |
       ((b0 + (b1 - b0) * t) | 0);

    this.add.rectangle(SX, SY - 2, 60, 58, 0x0a0514, 0.88)
      .setScrollFactor(0).setDepth(199).setStrokeStyle(1, 0x6622aa, 0.7);

    const g = this.add.graphics().setScrollFactor(0).setDepth(200);

    // t = 0 → fully asleep, t = 1 → fully awake
    const _draw = (t) => {
      g.clear();

      // Face colour fades from dim purple to bright purple
      g.fillStyle(lerpColor(0x33, 0x11, 0x66,  0x55, 0x22, 0xbb,  t), 1);
      g.fillCircle(SX, SY, R);
      g.lineStyle(2, lerpColor(0x77, 0x33, 0xcc,  0xcc, 0x66, 0xff,  t), 1);
      g.strokeCircle(SX, SY, R);

      // Eye opening: height goes from 1 (thin slit) to 10 (fully open)
      const eyeH = 1 + t * 9;
      const eyeColor = lerpColor(0x44, 0x22, 0x66,  0xff, 0xcc, 0x00,  t);
      g.fillStyle(eyeColor, 1);
      g.fillEllipse(SX - 8, SY - 4, 12, eyeH);
      g.fillEllipse(SX + 8, SY - 4, 12, eyeH);

      // Iris and pupil visible only once eyes are noticeably open
      if (t > 0.45) {
        const pupilAlpha = Math.min(1, (t - 0.45) / 0.35);
        g.fillStyle(0x110022, pupilAlpha);
        g.fillCircle(SX - 8, SY - 4, 3 * t);
        g.fillCircle(SX + 8, SY - 4, 3 * t);
        g.fillStyle(0xffffff, 0.8 * pupilAlpha);
        g.fillCircle(SX - 6, SY - 6, 1.5);
        g.fillCircle(SX + 10, SY - 6, 1.5);
      }

      // Mouth: smile arc fades out while flat line fades in
      g.lineStyle(2, lerpColor(0x99, 0x55, 0xdd,  0xcc, 0x66, 0xff,  t), 0.85);
      if (t < 0.5) {
        // Smile
        g.beginPath();
        g.arc(SX, SY + 6, 7, Phaser.Math.DegToRad(20), Phaser.Math.DegToRad(160));
        g.strokePath();
      } else {
        // Tense flat line
        g.lineBetween(SX - 6, SY + 10, SX + 6, SY + 10);
      }
    };

    _draw(0);

    // Tween helper: animate t between current and target value
    let _currentT = 0;
    const _transitionTo = (targetT, duration, onComplete) => {
      const startT = _currentT;
      this.tweens.addCounter({
        from: 0, to: 100, duration,
        ease: 'Sine.easeInOut',
        onUpdate: (tween) => {
          _currentT = startT + (targetT - startT) * (tween.getValue() / 100);
          _draw(_currentT);
        },
        onComplete,
      });
    };

    // "Z z z" while asleep
    const zText = this.add.text(SX + 22, SY - 22, 'z z', {
      fontSize: '9px', fontFamily: 'Georgia', color: '#9955dd', alpha: 0.7,
    }).setScrollFactor(0).setDepth(200);
    this.tweens.add({ targets: zText, y: zText.y - 6, alpha: 0, duration: 1800, yoyo: true, repeat: -1 });

    const warnText = this.add.text(SX, SY + R + 10, '⚠ STOP ⚠', {
      fontSize: '9px', fontFamily: 'Georgia', color: '#ffcc00',
      backgroundColor: '#33000099', padding: { x: 3, y: 2 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(200).setVisible(false);

    // Cycle: sleep → eyes open transition → awake → eyes close transition → repeat
    const _cycle = () => {
      if (this.gameOver) return;
      const sleepMs = Phaser.Math.Between(4000, 8000) / Math.max(1, countMod('sleeper'));
      this.time.delayedCall(sleepMs, () => {
        if (this.gameOver) return;
        // Eyes opening (640 ms)
        zText.setVisible(false);
        _transitionTo(1, 640, () => {
          if (this.gameOver) return;
          this._sleeperAwake = true;
          warnText.setVisible(true);

          const awakeMs = Phaser.Math.Between(2000, 4000);
          this.time.delayedCall(awakeMs, () => {
            if (this.gameOver) return;
            // Stop punishing immediately as eyes begin closing
            this._sleeperAwake = false;
            warnText.setVisible(false);
            // Eyes closing (100 ms — snap shut)
            _transitionTo(0, 100, () => {
              if (this.gameOver) return;
              zText.setVisible(true);
              _cycle();
            });
          });
        });
      });
    };
    _cycle();
  }

  createEnemies(lvl) {
    this.enemies = this.physics.add.group();
    const speedMult  = Math.pow(1.4, countMod('fast_enemies')) * Math.pow(0.6, countMod('slow_enemies'));
    const skipCount  = Math.min(countMod('less_enemies'), Math.max(0, lvl.enemies.length - 1));
    const enemyList  = lvl.enemies.slice(0, lvl.enemies.length - skipCount);
    enemyList.forEach(p => {
      const e = this.add.sprite(p.x, p.y, 'enemy_0').setOrigin(0.5);
      e.play('enemy_wobble');
      e.setData({ minX: p.minX, maxX: p.maxX, speed: p.speed * speedMult, dir: 1 });
      this.enemies.add(e);
      this.physics.add.existing(e);
      e.body.setAllowGravity(false);
      // Pick initial direction based on spawn position relative to patrol midpoint
      const initSpd = p.speed * speedMult;
      const midX = (p.minX + p.maxX) / 2;
      const initDir = p.x <= midX ? 1 : -1;
      e.setData('dir', initDir);
      e.body.setVelocityX(initSpd * initDir);
      e.setFlipX(initDir < 0);
      e.body.setSize(26, 26);
      e.body.setOffset(11, 10);
    });
  }

  createFlyingEnemies(lvl) {
    this.flyingEnemies = this.physics.add.group();
    this.bullets       = this.physics.add.group();
    const speedMult = Math.pow(1.4, countMod('fast_enemies')) * Math.pow(0.6, countMod('slow_enemies'));
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
      // Pick initial direction based on spawn position relative to patrol midpoint
      const feInitSpd = p.speed * speedMult;
      const feMidX = (p.minX + p.maxX) / 2;
      const feInitDir = p.x <= feMidX ? 1 : -1;
      fe.setData('dir', feInitDir);
      fe.body.setVelocityX(feInitSpd * feInitDir);
      fe.setFlipX(feInitDir < 0);
      fe.body.setSize(30, 22);
      fe.body.setOffset(5, 5);
      // slow_flyers: each stack adds 2s to the base cooldown (base 8s → 10s per stack)
      const baseInterval = p.shootInterval ?? 8000;
      const shootDelay   = baseInterval + countMod('slow_flyers') * 2000;
      this.time.addEvent({
        delay: shootDelay,
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
    if (window.SoundManager) SoundManager.sfxShoot();
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
        triggered:    false,
        chaseSpeed:   p.chaseSpeed   ?? 28,
        proximityR:   p.proximityR   ?? 110,
        tickInterval: (p.tickInterval ?? 333)
          * Math.pow(1.5, countMod('slow_counters'))
          / Math.pow(1.5, countMod('fast_counters')),
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
    // Note: enemies do NOT collide with platforms — they patrol at a fixed y
    // set in level data, so platform side-walls would block them.

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
          if (window.SoundManager) SoundManager.sfxLava();
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
      if (window.SoundManager) SoundManager.sfxCollectFirefly();
      if (this.firefliesCollected >= this.firefliesTotal) this.winLevel();
    });

    // Exit portal — reach it to complete the level
    if (this.exitPortalSensor) {
      this.physics.add.overlap(this.player, this.exitPortalSensor, () => {
        if (this.gameOver) return;
        this.winLevel();
      });
    }

    if (this.shovel) {
      this.physics.add.overlap(this.player, this.shovel, () => {
        if (!this.shovel || !this.shovel.active) return;
        this.shovel.destroy();
        this.shovel = null;
        this.scene.get('UIScene').showLockedLevel();
      });
    }

    // Falling stalagmites: stop on platforms, hurt player on contact
    if (this._stalagmiteGroup) {
      this.physics.add.collider(this._stalagmiteGroup, this.platforms, (stal) => {
        if (!stal.active || !stal.body || stal.getData('landed')) return;
        stal.setData('landed', true);
        stal.body.setAllowGravity(false);
        stal.body.setVelocity(0, 0);
      });
      this.physics.add.overlap(this.player, this._stalagmiteGroup, (_pl, stal) => {
        if (!stal.active || this.gameOver || this.isHurt) return;
        this.hurtPlayer(false);
      });
    }

    this.physics.add.overlap(this.player, this.enemies, (_pl, enemy) => {
      if (!enemy.active || this.gameOver) return;
      const fallingOnTop = this.player.body.velocity.y > 50 && this.player.y < enemy.y - 4;
      if (fallingOnTop) {
        enemy.destroy();
        this.player.body.setVelocityY(-400);
        if (window.SoundManager) SoundManager.sfxEnemyKill();
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
        if (window.SoundManager) SoundManager.sfxEnemyKill();
      } else if (!this.isHurt) {
        this.hurtPlayer(false);
      }
    });

    this.physics.add.overlap(this.player, this.bullets, (_pl, bullet) => {
      if (!bullet.active || this.gameOver) return;
      bullet.destroy();
      if (window.SoundManager) SoundManager.sfxBulletHit();
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
      if (window.SoundManager) SoundManager.sfxCollectPowerup();
    } else if (type === 'speed') {
      this.hasSpeed = true;
      uiScene.showPowerupIndicator('speed', DURATION);
      this.time.delayedCall(DURATION, () => { this.hasSpeed = false; });
      if (window.SoundManager) SoundManager.sfxCollectPowerup();
    } else if (type === 'heart') {
      if (this.playerLives < 5) {
        this.playerLives++;
        uiScene.updateLives(this.playerLives);
      }
      const heartFlash = this.add.circle(pu.x, pu.y, 28, 0xff3355, 0.7);
      this.tweens.add({ targets: heartFlash, alpha: 0, scale: 2.8, duration: 400, onComplete: () => heartFlash.destroy() });
      uiScene.showPowerupIndicator('heart', 1200);
      if (window.SoundManager) SoundManager.sfxExtraLife();
    }
  }

  // ?? Player state ??????????????????????????????????????????????????????????????

  hurtPlayer(fatal) {
    if (this.playerLives <= 0) return;
    // Standing still while the Sleeper watches grants full immunity
    if (this._sleeperAwake && Math.abs(this.player.body.velocity.x) <= 15) return;
    this.isHurt = true;
    this.playerLives--;
    this._halfHurt = false;
    this.scene.get('UIScene').updateLives(this.playerLives, false);
    this.cameras.main.flash(150, fatal ? 220 : 160, 40, 40);
    this.player.body.setVelocity(-80, -280);
    if (window.SoundManager) SoundManager.sfxLoseLife();
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
    if (this.gameOver) return;
    this.gameOver = true;
    this.physics.pause();
    if (window.SoundManager) SoundManager.sfxLevelComplete();

    // Add this level's fireflies to the persistent bank
    window.fireflyBank = (window.fireflyBank || 0) + this.firefliesCollected;

    // Investment bonus: +30 fireflies per stack if no lives were lost this level
    if (hasMod('investment') && this.playerLives >= this._investmentLives) {
      const bonus = 30 * countMod('investment');
      window.fireflyBank += bonus;
      this._cheatToast('+' + bonus + ' ✦ ' + T('mod_investment'));
    }

    const next = this.currentLevel + 1;
    if (next < LEVELS.length) {
      this.scene.setVisible(false, 'UIScene');
      this.scene.launch('ModifierScene', {
        nextLevel: next,
        lives: this.playerLives,
        fireflyBank: window.fireflyBank,
      });
    } else {
      this.scene.get('UIScene').showVictory();
    }
  }

  _applySleeperHalfHurt() {
    if (this._halfHurt) {
      // Second half-hit: consume the buffer and lose a full heart
      this._halfHurt = false;
      this.cameras.main.shake(180, 0.012);
      this.hurtPlayer(false);
    } else {
      // First half-hit: store the buffer and show it in the HUD
      this._halfHurt = true;
      this.cameras.main.shake(90, 0.006);
      if (window.SoundManager) SoundManager.sfxLoseLife();
      this.scene.get('UIScene').updateLives(this.playerLives, true);
      // Brief flicker but shorter than a full hurt
      this.isHurt = true;
      this.tweens.add({
        targets: this.player, alpha: 0.5, duration: 80, yoyo: true, repeat: 2,
        onComplete: () => { this.isHurt = false; },
      });
    }
  }

  loseGame() {
    this.gameOver = true;
    this.physics.pause();
    if (window.SoundManager) SoundManager.sfxGameOver();
    this.scene.get('UIScene').showGameOver();
  }

  // ?? Update ????????????????????????????????????????????????????????????????????

  update(time, delta) {
    if (this.gameOver || !this.player.active) return;

    // Sleeper entity: moving while eyes open = full heart; standing still = immune to all damage
    if (this._sleeperAwake && hasMod('sleeper') && !this.isHurt) {
      if (Math.abs(this.player.body.velocity.x) > 15 &&
          time - this._sleeperHurtAt > 800) {
        this._sleeperHurtAt = time;
        this._halfHurt = false;
        this.cameras.main.shake(180, 0.012);
        this.hurtPlayer(false);
      }
    }

    // Proximity-triggered stalagmites: drop when player steps within 50px
    if (this._stalPending && this.player) {
      const px = this.player.x;
      this._stalPending.forEach(s => {
        if (!s.dropped && Math.abs(s.x - px) <= 50) {
          this._stalDrop(s);
        }
      });
    }

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

    // Analogue axis from the joystick strip (-1..+1), 0 when not active
    const axisX = mobileInput.axisX || 0;

    if (axisX !== 0) {
      // Mobile analogue: scale speed continuously by axis factor
      this.player.body.setVelocityX(baseSpeed * axisX);
      this.player.setFlipX(axisX < 0);
      this.player.play('player_walk', true);
    } else if (goLeft) {
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
    // Jump heights stack: each high_jump ×1.12, each reduced_jump ×0.85
    const jumpScale = Math.pow(1.12, countMod('high_jump')) * Math.pow(0.85, countMod('reduced_jump'));
    const jumpV   = Math.round(-460 * jumpScale);
    const dJumpV  = Math.round(-430 * jumpScale);
    const cutV    = Math.round(-180 * jumpScale);

    if (jumpJustDown) {
      if (onGround) {
        this.player.body.setVelocityY(jumpV);
        this._jumpHoldTime = 0;
        this._jumpHolding  = true;
        if (window.SoundManager) SoundManager.sfxJump();
      } else if (this.hasDoubleJump && !this.doubleJumpUsed) {
        this.doubleJumpUsed = true;
        this.player.body.setVelocityY(dJumpV);
        this._jumpHolding = false;
        if (window.SoundManager) SoundManager.sfxDoubleJump();
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
      const minX = e.getData('minX'), maxX = e.getData('maxX');
      const spd  = e.getData('speed');
      let   dir  = e.getData('dir') ?? 1;
      // Use half sprite width (24px) so the visual edge doesn't overshoot
      const hw = 24;
      if (e.x - hw <= minX && dir < 0) { dir =  1; e.setData('dir', dir); e.setFlipX(false); }
      else if (e.x + hw >= maxX && dir > 0) { dir = -1; e.setData('dir', dir); e.setFlipX(true);  }
      e.body.setVelocityX(spd * dir);
    });

    // Flying enemy patrol
    const t = this.time.now / 1000;
    this.flyingEnemies.getChildren().forEach(fe => {
      if (!fe.active || !fe.body) return;
      const minX = fe.getData('minX'), maxX = fe.getData('maxX');
      const spd  = fe.getData('speed');
      let   dir  = fe.getData('dir') ?? 1;
      const baseY = fe.getData('baseY'), hoverT = fe.getData('hoverT');
      const hw = 20;
      if (fe.x - hw <= minX && dir < 0) { dir =  1; fe.setData('dir', dir); fe.setFlipX(false); }
      else if (fe.x + hw >= maxX && dir > 0) { dir = -1; fe.setData('dir', dir); fe.setFlipX(true);  }
      fe.body.setVelocityX(spd * dir);
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
      if (dist < c.proximityR) c.triggered = true;
      if (c.triggered && now - c.lastTick >= c.tickInterval && !this.isHurt) {
        c.lastTick = now;
        c.count = Math.min(5, c.count + 1);
        c.sprite.setTexture('counter_' + c.count);
        this.tweens.add({ targets: c.sprite, scaleX: 1.5, scaleY: 1.5, duration: 80, yoyo: true, ease: 'Power2' });
        if (window.SoundManager) SoundManager.sfxCounterTick(c.count);
        if (c.count >= 5) {
          const ex = this.add.circle(c.sprite.x, c.sprite.y, 40, 0x5500ff, 0.8);
          this.tweens.add({ targets: ex, alpha: 0, scale: 3, duration: 450, onComplete: () => ex.destroy() });
          const explodeDx = this.player.x - c.sprite.x;
          const explodeDy = this.player.y - c.sprite.y;
          const explodeDist = Math.sqrt(explodeDx * explodeDx + explodeDy * explodeDy);
          c.sprite.destroy();
          deadCounters.push(c);
          if (window.SoundManager) SoundManager.sfxCounterExplode();
          if (explodeDist <= c.proximityR * 2 && !this.isHurt && !this.gameOver) this.hurtPlayer(false);
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
    this.nextLevel     = data.nextLevel;
    this.lives         = data.lives;
    this.bank          = data.fireflyBank ?? window.fireflyBank ?? 0;
    window.fireflyBank = this.bank;
  }

  create() {
    const W = VIEW_W, H = VIEW_H;

    // Reward/cost by category
    const CAT = {
      easier: { cost: -15, label: T('shop_cost')        || '-15 ✦', color: 0x33bb66, hex: '#33bb66', hoverFill: 0x0e2218 },
      harder: { cost:   5, label: T('shop_earn_neg')    || '+5 ✦',  color: 0xdd3333, hex: '#dd3333', hoverFill: 0x280e0e },
      twist:  { cost:   3, label: T('shop_earn_twi')    || '+3 ✦',  color: 0x3388ff, hex: '#3388ff', hoverFill: 0x0e1828 },
      entity: { cost:  25, label: T('shop_earn_entity') || '+25 ✦', color: 0xbb44ff, hex: '#bb44ff', hoverFill: 0x1a0828 },
    };

    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.82);

    this.add.text(W / 2, 28, T('shop_title') || '✦ Firefly Shop ✦', {
      fontSize: '24px', fontFamily: 'Georgia', color: '#ffeeaa',
    }).setOrigin(0.5);

    this._bankText = this.add.text(W / 2, 60, '', {
      fontSize: '14px', fontFamily: 'Georgia', color: '#88ffaa',
    }).setOrigin(0.5);
    this._updateBank();

    // Legend
    const legendY = 82;
    [
      { label: T('shop_legend_easier') || 'Upgrade  -15✦', hex: '#33bb66' },
      { label: T('shop_legend_harder') || 'Curse  +5✦',    hex: '#dd5555' },
      { label: T('shop_legend_twist')  || 'Twist  +3✦',    hex: '#5599ff' },
      { label: T('shop_legend_entity') || 'Entity  +25✦',  hex: '#bb44ff' },
    ].forEach((l, i) => {
      this.add.text(W/2 - 300 + i * 200, legendY, l.label, {
        fontSize: '11px', fontFamily: 'Georgia', color: l.hex,
      }).setOrigin(0.5);
    });

    // --- Build card pool: exactly 1 per category, random pick, stacks allowed ---
    const shuffle = arr => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const pickOne = cat => {
      const pool = shuffle(MODIFIERS_DATA.filter(m => m.category === cat));
      return pool[0] ?? null;
    };

    const picks = [pickOne('easier'), pickOne('harder'), pickOne('twist'), pickOne('entity')].filter(Boolean);

    // Layout: up to 4 cards in a single row, centered
    const cardW = 168, cardH = 220, gap = 16;
    const totalW = picks.length * cardW + (picks.length - 1) * gap;
    const startX = (W - totalW) / 2;
    const startY = 110;

    this._cards = [];

    picks.forEach((mod, i) => {
      const cx  = startX + i * (cardW + gap);
      const cy  = startY;
      const cat = CAT[mod.category];

      const card = this.add.rectangle(cx + cardW/2, cy + cardH/2, cardW, cardH, 0x0a1628, 1)
        .setStrokeStyle(2, cat.color);

      this._drawModIcon(cx + cardW/2, cy + 44, mod.icon, cat.color);

      this.add.text(cx + cardW/2, cy + 82, T(mod.label_key), {
        fontSize: '14px', fontFamily: 'Georgia', color: cat.hex,
        wordWrap: { width: cardW - 16 }, align: 'center',
      }).setOrigin(0.5, 0);

      this.add.text(cx + cardW/2, cy + 108, T(mod.desc_key), {
        fontSize: '11px', fontFamily: 'Georgia', color: '#99aacc',
        wordWrap: { width: cardW - 16 }, align: 'center',
      }).setOrigin(0.5, 0);

      // Action label (cost/reward)
      const actionText = this.add.text(cx + cardW/2, cy + cardH - 36, cat.label, {
        fontSize: '13px', fontFamily: 'Georgia', color: cat.hex, fontStyle: 'bold',
      }).setOrigin(0.5, 0);

      // Stack count badge — shows how many times already active
      const stackBadge = this.add.text(cx + cardW - 10, cy + 8, '', {
        fontSize: '11px', fontFamily: 'Georgia', color: cat.hex,
        backgroundColor: '#0a1628', padding: { x: 4, y: 2 },
      }).setOrigin(1, 0);

      const zone = this.add.rectangle(cx + cardW/2, cy + cardH/2, cardW, cardH, 0xffffff, 0)
        .setInteractive({ useHandCursor: true });

      const cardData = { card, zone, actionText, stackBadge, mod, cat, usedThisVisit: false };
      this._cards.push(cardData);

      zone.on('pointerover', () => {
        if (this._canInteract(cardData)) card.setFillStyle(cat.hoverFill);
      });
      zone.on('pointerout',  () => card.setFillStyle(0x0a1628));
      zone.on('pointerdown', () => this._interact(cardData));

      this._refreshCard(cardData);
    });

    // Continue button
    const contBtn = this.add.text(W / 2, H - 36, T('shop_continue') || '▶ Continue to next level', {
      fontSize: '14px', fontFamily: 'Georgia', color: '#88dd88',
      backgroundColor: '#0e2218', padding: { x: 16, y: 9 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    contBtn.on('pointerover', () => contBtn.setColor('#ccffcc'));
    contBtn.on('pointerout',  () => contBtn.setColor('#88dd88'));
    contBtn.on('pointerdown', () => this._advance());
  }

  _updateBank() {
    this._bankText.setText('✦ ' + this.bank + ' fireflies');
  }

  // Can the player interact with this card?
  _canInteract(cardData) {
    if (cardData.usedThisVisit) return false;
    // Easier costs fireflies — need enough
    if (cardData.mod.category === 'easier' && this.bank < 15) return false;
    return true;
  }

  _refreshCard(cardData) {
    const stacks = countMod(cardData.mod.id);
    const canDo  = this._canInteract(cardData);
    // Stack badge shows total stacks across all levels
    cardData.stackBadge.setText(stacks > 0 ? '×' + stacks : '');
    cardData.card.setAlpha(canDo ? 1 : 0.4);
    cardData.card.setStrokeStyle(2, cardData.usedThisVisit ? 0x226622 :
                                    canDo ? cardData.cat.color : 0x334433);
    if (canDo) {
      cardData.zone.setInteractive({ useHandCursor: true });
    } else {
      cardData.zone.removeInteractive();
    }
    // Show a checkmark overlay when used this visit
    cardData.actionText.setText(cardData.usedThisVisit ? '✓' : cardData.cat.label);
    cardData.actionText.setColor(cardData.usedThisVisit ? '#44ff88' : cardData.cat.hex);
  }

  _interact(cardData) {
    const mod = cardData.mod;
    if (!this._canInteract(cardData)) return;

    cardData.usedThisVisit = true;
    window.activeModifiers.push(mod.id);

    if (mod.category === 'easier') {
      this.bank -= 15;
      if (mod.id === 'extra_life') this.lives = Math.min(5, this.lives + 1);
    } else if (mod.category === 'harder') {
      this.bank += 5;
    } else if (mod.category === 'twist') {
      this.bank += 3;
    } else if (mod.category === 'entity') {
      this.bank += 25;
    }

    window.fireflyBank = this.bank;
    this._updateBank();
    this._cards.forEach(c => this._refreshCard(c));

    // Flash feedback
    const flashColor = mod.category === 'easier' ? 0x1a4a2a :
                       mod.category === 'harder'  ? 0x4a1a1a :
                       mod.category === 'entity'  ? 0x280a40 : 0x1a2a4a;
    this.tweens.add({
      targets: cardData.card, duration: 180, yoyo: true,
      onStart:    () => cardData.card.setFillStyle(flashColor),
      onComplete: () => cardData.card.setFillStyle(0x0a1628),
    });
  }

  _drawModIcon(cx, cy, icon, color) {
    const g = this.add.graphics();
    g.fillStyle(color, 0.25); g.fillCircle(cx, cy, 22);
    g.lineStyle(2, color, 0.7); g.strokeCircle(cx, cy, 22);
    g.fillStyle(color, 0.9);
    switch (icon) {
      case 'sword':
        g.fillRect(cx - 2, cy - 14, 4, 22); g.fillRect(cx - 8, cy - 2, 16, 4); break;
      case 'snail':
        g.fillCircle(cx, cy + 3, 9); g.fillRect(cx - 10, cy + 4, 6, 5); break;
      case 'heart':
        g.fillCircle(cx - 4, cy - 1, 7); g.fillCircle(cx + 4, cy - 1, 7);
        g.fillTriangle(cx - 10, cy + 3, cx + 10, cy + 3, cx, cy + 13); break;
      case 'down':
        g.fillTriangle(cx, cy + 12, cx - 9, cy - 3, cx + 9, cy - 3); break;
      case 'up':
        g.fillTriangle(cx, cy - 12, cx - 9, cy + 3, cx + 9, cy + 3); break;
      case 'clock':
        g.strokeCircle(cx, cy, 12);
        g.fillRect(cx - 1, cy - 8, 2, 9); g.fillRect(cx, cy - 1, 7, 2); break;
      case 'ice':
        g.fillRect(cx - 12, cy - 2, 24, 4); g.fillRect(cx - 2, cy - 12, 4, 24);
        g.fillRect(cx - 9, cy - 9, 3, 3); g.fillRect(cx + 6, cy - 9, 3, 3); break;
      case 'wing':
        g.fillTriangle(cx - 2, cy, cx - 14, cy - 10, cx - 14, cy + 6);
        g.fillTriangle(cx + 2, cy, cx + 14, cy - 10, cx + 14, cy + 6);
        g.fillEllipse(cx, cy + 2, 8, 14); break;
      case 'eye':
        g.fillEllipse(cx, cy, 26, 14);
        g.fillStyle(0x000000, 1); g.fillCircle(cx, cy, 5);
        g.fillStyle(color, 1);   g.fillCircle(cx + 2, cy - 2, 2);
        g.lineStyle(1.5, color, 0.7);
        g.lineBetween(cx - 10, cy - 6, cx - 8, cy - 10);
        g.lineBetween(cx,      cy - 7, cx,     cy - 11);
        g.lineBetween(cx + 10, cy - 6, cx + 8, cy - 10);
        break;
      case 'timer_down':
        // Clock body
        g.lineStyle(2, color, 0.9); g.strokeCircle(cx, cy + 2, 11);
        g.fillRect(cx - 1, cy - 6, 2, 8); g.fillRect(cx, cy - 1, 6, 2);
        // Down arrow below
        g.fillTriangle(cx, cy + 16, cx - 6, cy + 8, cx + 6, cy + 8); break;
      case 'timer_up':
        // Clock body
        g.lineStyle(2, color, 0.9); g.strokeCircle(cx, cy + 2, 11);
        g.fillRect(cx - 1, cy - 6, 2, 8); g.fillRect(cx, cy - 1, 6, 2);
        // Up arrow above
        g.fillTriangle(cx, cy - 15, cx - 6, cy - 7, cx + 6, cy - 7); break;
      case 'coin':
        // Coin circle with firefly ✦ inside
        g.lineStyle(2, color, 0.9); g.strokeCircle(cx, cy, 13);
        g.fillCircle(cx, cy, 5);
        g.fillStyle(0xffdd44, 1);
        g.fillTriangle(cx, cy - 8, cx - 5, cy + 4, cx + 5, cy + 4);
        g.fillTriangle(cx, cy + 8, cx - 5, cy - 4, cx + 5, cy - 4); break;
      case 'minus':
        // Enemy silhouette with minus
        g.fillCircle(cx, cy - 6, 7);
        g.fillRect(cx - 6, cy + 1, 12, 9);
        g.fillStyle(0x000000, 0.8); g.fillRect(cx - 8, cy + 5, 16, 3); break;
      case 'flame':
        // Lava / flame shape
        g.fillTriangle(cx, cy - 14, cx - 10, cy + 8, cx + 10, cy + 8);
        g.fillStyle(0xffaa00, 0.9);
        g.fillTriangle(cx, cy - 6, cx - 6, cy + 8, cx + 6, cy + 8);
        g.fillStyle(0xffffff, 0.6); g.fillCircle(cx, cy + 4, 3); break;
      case 'flash':
        // Lightning bolt
        g.fillTriangle(cx + 3, cy - 14, cx - 9, cy + 2, cx + 1, cy + 2);
        g.fillTriangle(cx - 3, cy + 14, cx + 9, cy - 2, cx - 1, cy - 2); break;
    }
    g.destroy();
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

    // Restart handler — used by both R-key and tap/click on overlay
    this._doRestart = () => {
      if (!this.overlay.visible) return;
      this.overlay.setVisible(false);
      window.activeModifiers = [];
      window.fireflyBank     = 0;
      this.scene.get('GameScene').scene.restart({ level: 0, lives: 3 });
      this.scene.restart({ level: 0, lives: 3 });
    };

    this.input.keyboard.on('keydown-R', this._doRestart);

    // Tap / click anywhere on the canvas restarts when the overlay is showing
    this.input.on('pointerdown', this._doRestart);
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
  updateLives(lives, halfHurt = false) {
    const full = '\u2665'.repeat(Math.max(0, lives)); // ♥
    const half = halfHurt ? '\u2661' : '';            // ♡ (hollow)
    this.livesText.setText(full + half);
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

    // Pre-fetch music bytes (no AudioContext yet — safe before user gesture).
    // startMusic() is called from GameScene.create() after the first user input.
    if (window.SoundManager) {
      const wasMuted = localStorage.getItem('mm_muted') === '1';
      SoundManager.setMuted(wasMuted);
      SoundManager.loadMusic();
    }

    // On mobile landscape, use EXPAND so the camera shows a wider slice of the
    // world without stretching. On everything else, use FIT to preserve aspect ratio.
    const _isMobileLandscape = () =>
      window.matchMedia('(pointer: coarse) and (orientation: landscape)').matches;

    const _scaleMode = _isMobileLandscape() ? Phaser.Scale.EXPAND : Phaser.Scale.FIT;

    new Phaser.Game({
      type: Phaser.CANVAS,
      width: VIEW_W,
      height: VIEW_H,
      parent: 'game-container',
      backgroundColor: '#060d1a',
      scale: {
        mode: _scaleMode,
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

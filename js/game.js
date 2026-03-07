/**
 * Moss & Moonlight ? Enchanted Forest Platformer
 * Controls: ?? ? bewegen, ? springen, spring op vijand = verslaan, R = opnieuw
 *
 * Features:
 *  - Scrollende wereld (3200px breed, camera volgt speler)
 *  - Gras- en struikenbodem
 *  - Parallax achtergrond
 *  - Powerups: dubbele sprong (blauw), snelheid (oranje), hart (rood)
 *  - 3 levels met eigen bioom en stijgende moeilijkheid
 */

// ??? Constants ????????????????????????????????????????????????????????????????

const WORLD_W = 3200;   // total level width in pixels
const VIEW_W  = 800;
const VIEW_H  = 600;
const GROUND_Y = VIEW_H - 40; // y of top of ground

// ??? Level definitions ????????????????????????????????????????????????????????
// Loaded asynchronously from levels.json ? see bottom of file for startup code.

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
    this.counterList        = [];   // active Counter instances

    // Active powerup timers
    this.hasDoubleJump  = false;
    this.hasSpeed       = false;
    this.doubleJumpUsed = false;
    this._jumpHolding   = false;
    this._jumpHoldTime  = 0;

    // Load level data ? editor overrides take precedence over defaults
    const _saved = localStorage.getItem('mm_level_' + this.currentLevel);
    const lvl = _saved
      ? { ...LEVELS[this.currentLevel], ...JSON.parse(_saved) }
      : LEVELS[this.currentLevel];

    // Physics world bounds = full level width
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
    this.setupCollisions();
    this.cursors = this.input.keyboard.createCursorKeys();

    // Register admin API for the HTML admin panel
    this._setupCheatCodes();
    this.events.on('shutdown', () => { window.gameAdminAPI = null; });

    // Camera follows player, clamped to world
    this.cameras.main.setBounds(0, 0, WORLD_W, VIEW_H);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.scene.launch('UIScene', { level: this.currentLevel, lives: this.playerLives });
  }

  // ?? Developer / Admin API ???????????????????????????????????????????????????

  _setupCheatCodes() {
    window.gameAdminAPI = {
      jumpToLevel: (idx) => {
        if (idx < 0 || idx >= LEVELS.length) return;
        this._cheatToast(`Admin: Level ${idx + 1} ? ${LEVELS[idx].name}`);
        this.time.delayedCall(800, () => {
          this.scene.get('UIScene').scene.restart({ level: idx, lives: this.playerLives });
          this.scene.restart({ level: idx, lives: this.playerLives });
        });
      },
      skipLevel: () => {
        const next = this.currentLevel + 1;
        if (next < LEVELS.length) {
          this._cheatToast(`Admin: Naar level ${next + 1} ? ${LEVELS[next].name}`);
          this.time.delayedCall(800, () => {
            this.scene.get('UIScene').scene.restart({ level: next, lives: this.playerLives });
            this.scene.restart({ level: next, lives: this.playerLives });
          });
        } else {
          this._cheatToast('Admin: Laatste level voltooid!');
          this.time.delayedCall(800, () => this.winLevel());
        }
      },
      restoreLives: () => {
        this.playerLives = 3;
        this.scene.get('UIScene').updateLives(this.playerLives);
        this._cheatToast('Admin: Levens hersteld ???');
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
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(999);
    this.tweens.add({
      targets: toast, alpha: { from: 1, to: 0 },
      delay: 600, duration: 500,
      onComplete: () => toast.destroy(),
    });
  }

  // ?? Sprite generation ???????????????????????????????????????????????????????

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
        // Eyes ? two small dark dots
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
        // Shadow Imp ? 48?40 canvas, 4-frame walk cycle
        // Frame 0: neutral, Frame 1: left lean, Frame 2: squat, Frame 3: right lean
        const g = this.add.graphics();
        const legOff  = [-4, -7, 0, 7][f];     // leg sway
        const bodyOff = [0, -1, 2, -1][f];      // body bob
        const armAng  = [0, 14, 0, -14][f];     // arm swing angle offset
        const cx = 24, cy = 20 + bodyOff;

        // ?? Shadow / glow beneath feet ??????????????????????????????????????
        g.fillStyle(0x000000, 0.22);
        g.fillEllipse(cx, 38, 28, 7);

        // ?? Legs (two stubby rounded legs) ??????????????????????????????????
        g.fillStyle(0x1a0d2e, 1);
        // left leg
        g.fillRoundedRect(cx - 10 + legOff,  cy + 10, 8, 11, 3);
        // right leg
        g.fillRoundedRect(cx +  2 - legOff,  cy + 10, 8, 11, 3);
        // Clawed feet
        g.fillStyle(0x0d0820, 1);
        g.fillRoundedRect(cx - 12 + legOff, cy + 19, 11, 5, 2);
        g.fillRoundedRect(cx +  1 - legOff, cy + 19, 11, 5, 2);
        // Claw tips
        g.fillStyle(0x6622aa, 1);
        g.fillTriangle(cx - 13 + legOff, cy + 24, cx - 10 + legOff, cy + 22, cx - 12 + legOff, cy + 26);
        g.fillTriangle(cx +  0 - legOff, cy + 24, cx +  3 - legOff, cy + 22, cx +  1 - legOff, cy + 26);

        // ?? Body ?????????????????????????????????????????????????????????????
        g.fillStyle(0x2a1040, 0.97);
        g.fillEllipse(cx, cy + 2, 26, 22);
        // Belly shimmer
        g.fillStyle(0x3d1a5a, 0.55);
        g.fillEllipse(cx, cy + 4, 14, 12);

        // ?? Arms (swing forward/back) ?????????????????????????????????????????
        // Left arm
        const laX = cx - 13, laY = cy - 2;
        g.fillStyle(0x1a0d2e, 1);
        g.fillRoundedRect(laX - 3, laY + armAng * 0.3, 6, 10, 3);
        // Left hand claw
        g.fillStyle(0x6622aa, 1);
        g.fillTriangle(laX - 2, laY + 10 + armAng * 0.3, laX + 1, laY + 8 + armAng * 0.3, laX, laY + 13 + armAng * 0.3);

        // Right arm
        const raX = cx + 13, raY = cy - 2;
        g.fillStyle(0x1a0d2e, 1);
        g.fillRoundedRect(raX - 3, raY - armAng * 0.3, 6, 10, 3);
        // Right hand claw
        g.fillStyle(0x6622aa, 1);
        g.fillTriangle(raX - 2, raY + 10 - armAng * 0.3, raX + 1, raY + 8 - armAng * 0.3, raX, raY + 13 - armAng * 0.3);

        // ?? Head ?????????????????????????????????????????????????????????????
        g.fillStyle(0x2a1040, 0.97);
        g.fillEllipse(cx, cy - 10, 22, 20);

        // Horns
        g.fillStyle(0x4a1880, 1);
        g.fillTriangle(cx - 8, cy - 17, cx - 11, cy - 28, cx - 4, cy - 17);
        g.fillTriangle(cx + 8, cy - 17, cx + 11, cy - 28, cx + 4, cy - 17);
        // Horn highlight
        g.fillStyle(0x8833cc, 0.5);
        g.fillTriangle(cx - 8, cy - 18, cx - 10, cy - 26, cx - 6, cy - 18);
        g.fillTriangle(cx + 8, cy - 18, cx + 10, cy - 26, cx + 6, cy - 18);

        // ?? Eyes (glowing) ???????????????????????????????????????????????????
        // Outer glow
        g.fillStyle(0xff4400, 0.35);
        g.fillCircle(cx - 5, cy - 11, 5);
        g.fillCircle(cx + 5, cy - 11, 5);
        // Iris
        g.fillStyle(0xff6600, 1);
        g.fillCircle(cx - 5, cy - 11, 3.5);
        g.fillCircle(cx + 5, cy - 11, 3.5);
        // Pupil
        g.fillStyle(0x1a0000, 1);
        g.fillCircle(cx - 5, cy - 11, 1.8);
        g.fillCircle(cx + 5, cy - 11, 1.8);
        // Eye glint
        g.fillStyle(0xffffff, 0.8);
        g.fillCircle(cx - 4, cy - 12, 0.9);
        g.fillCircle(cx + 6, cy - 12, 0.9);

        // ?? Mouth (jagged grin) ???????????????????????????????????????????????
        g.fillStyle(0x0d0010, 1);
        g.fillRoundedRect(cx - 5, cy - 6, 10, 4, 2);
        // Teeth
        g.fillStyle(0xddccff, 0.9);
        g.fillTriangle(cx - 4, cy - 6, cx - 2, cy - 6, cx - 3, cy - 3);
        g.fillTriangle(cx,     cy - 6, cx + 2, cy - 6, cx + 1, cy - 3);

        // ?? Body outline / rim light ??????????????????????????????????????????
        g.lineStyle(1.5, 0x5522aa, 0.55);
        g.strokeEllipse(cx, cy + 2, 26, 22);
        g.strokeEllipse(cx, cy - 10, 22, 20);

        g.generateTexture('enemy_' + f, 48, 40);
        g.destroy();
      }

      // Flying enemy ? bat-like silhouette, 4 wing-flap frames
      for (let f = 0; f < 4; f++) {
        const g = this.add.graphics();
        const wingSpread = [14, 18, 12, 8][f];
        g.fillStyle(0x6622aa, 0.9);
        g.fillTriangle(20, 20, 0,  20 - wingSpread, 20, 14);
        g.fillTriangle(20, 20, 40, 20 - wingSpread, 20, 14);
        g.lineStyle(1, 0xaa44ff, 0.6);
        g.strokeTriangle(20, 20, 0,  20 - wingSpread, 20, 14);
        g.strokeTriangle(20, 20, 40, 20 - wingSpread, 20, 14);
        g.fillStyle(0x3a0a5a, 1);
        g.fillEllipse(20, 18, 18, 14);
        g.fillStyle(0xff2222, 1);
        g.fillCircle(15, 16, 3);
        g.fillCircle(25, 16, 3);
        g.fillStyle(0xff8888, 0.8);
        g.fillCircle(15, 15, 1.5);
        g.fillCircle(25, 15, 1.5);
        g.generateTexture('flyer_' + f, 40, 32); g.destroy();
      }

      // Counter orb ? 6 states (count 0?5), pulsing void sphere with digit
      for (let n = 0; n < 6; n++) {
        if (!this.textures.exists('counter_' + n)) {
          const g = this.add.graphics();
          // Outer glow ring ? intensity grows with count
          const alpha = 0.15 + n * 0.14;
          g.fillStyle(0x2200ff, alpha);
          g.fillCircle(18, 18, 18);
          // Core sphere ? darkens then brightens toward explosion
          const coreColors = [0x110033, 0x1a0044, 0x280055, 0x3300aa, 0x4400cc, 0x5500ff];
          g.fillStyle(coreColors[n], 0.95);
          g.fillCircle(18, 18, 13);
          // Rim highlight
          g.fillStyle(0x8866ff, 0.5);
          g.fillCircle(13, 13, 5);
          // Digit (pixel shapes)
          g.fillStyle(0xffffff, 1);
          if (n === 0) {
            g.fillRect(15, 11, 6, 1); g.fillRect(15, 25, 6, 1);
            g.fillRect(14, 12, 1, 13); g.fillRect(21, 12, 1, 13);
          } else if (n === 1) {
            g.fillRect(17, 11, 2, 15);
          } else if (n === 2) {
            g.fillRect(14, 11, 8, 2); g.fillRect(14, 17, 8, 2); g.fillRect(14, 24, 8, 2);
            g.fillRect(21, 12, 2, 5); g.fillRect(14, 19, 2, 5);
          } else if (n === 3) {
            g.fillRect(14, 11, 8, 2); g.fillRect(14, 17, 8, 2); g.fillRect(14, 24, 8, 2);
            g.fillRect(21, 12, 2, 13);
          } else if (n === 4) {
            g.fillRect(14, 11, 1, 7); g.fillRect(21, 11, 1, 14);
            g.fillRect(14, 17, 8, 2);
          } else {
            // 5
            g.fillRect(14, 11, 8, 2); g.fillRect(14, 17, 8, 2); g.fillRect(14, 24, 8, 2);
            g.fillRect(14, 12, 2, 5); g.fillRect(21, 19, 2, 5);
          }
          g.generateTexture('counter_' + n, 36, 36); g.destroy();
        }
      }

      // Bullet ? small shard shot by flyers
      if (!this.textures.exists('bullet')) {
        const g = this.add.graphics();
        g.fillStyle(0xff4444, 1);
        g.fillEllipse(8, 4, 14, 7);
        g.fillStyle(0xffaaaa, 0.7);
        g.fillEllipse(6, 3, 6, 3);
        g.generateTexture('bullet', 16, 8); g.destroy();
      }
    }

    // Spike
    if (!this.textures.exists('spike')) {
      const g = this.add.graphics();
      g.fillStyle(0xbbbbbb, 1);
      for (let i = 0; i < 4; i++) g.fillTriangle(i*10, 16, i*10+5, 0, i*10+10, 16);
      g.generateTexture('spike', 40, 16); g.destroy();
    }

    // Powerup textures
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
          g.fillCircle(9, 10, 7);
          g.fillCircle(21, 10, 7);
          g.fillTriangle(2, 13, 28, 13, 15, 28);
          g.fillStyle(0xff7799, 0.6);
          g.fillCircle(7, 8, 3);
        } else {
          g.fillStyle(def.color, 0.9);
          g.fillRoundedRect(2, 2, 26, 26, 8);
          g.lineStyle(2, 0xffffff, 0.7);
          g.strokeRoundedRect(2, 2, 26, 26, 8);
        }
        g.generateTexture(def.key, 30, 30); g.destroy();
      }
    });

    // Shovel ? golden shovel that unlocks level 6 (locked)
    if (!this.textures.exists('shovel')) {
      const g = this.add.graphics();
      // Handle
      g.fillStyle(0x8b5e2a, 1);
      g.fillRoundedRect(13, 2, 5, 20, 2);
      // Grip band
      g.fillStyle(0xccaa44, 1);
      g.fillRect(12, 16, 7, 3);
      // Blade
      g.fillStyle(0xf0d060, 1);
      g.fillTriangle(8, 22, 23, 22, 15, 34);
      g.fillRect(9, 19, 13, 5);
      // Shine
      g.fillStyle(0xfff0a0, 0.7);
      g.fillTriangle(11, 22, 17, 22, 13, 29);
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

  // ?? World building ??????????????????????????????????????????????????????????

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
  }

  createGround(lvl) {
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
      const bw = 30 + (x % 40);
      const bh = 18 + (x % 18);
      g.fillStyle(lvl.bushColor, 0.9);
      g.fillEllipse(x, GROUND_Y - bh / 2, bw, bh);
      g.fillEllipse(x + bw * 0.35, GROUND_Y - bh * 0.7, bw * 0.6, bh * 0.7);
      g.fillEllipse(x - bw * 0.3,  GROUND_Y - bh * 0.6, bw * 0.5, bh * 0.6);
    }
    for (let x = 30; x < WORLD_W; x += 90 + ((x * 13) % 60)) {
      g.fillStyle(lvl.flowerColor, 0.85);
      g.fillCircle(x, GROUND_Y - 10, 4);
      g.fillStyle(0xffffff, 0.4);
      g.fillCircle(x, GROUND_Y - 10, 2);
    }
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

    const groundH = VIEW_H - GROUND_Y;
    const groundBody = this.add.rectangle(WORLD_W / 2, GROUND_Y + groundH / 2, WORLD_W, groundH)
      .setVisible(false);
    this.platforms.add(groundBody, true);
    groundBody.body.setSize(WORLD_W, groundH);
    groundBody.body.reset(WORLD_W / 2, GROUND_Y + groundH / 2);

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
          .setVisible(false)
          .setDisplaySize(8, 10)
          .refreshBody();
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
      this.physics.add.existing(img, true); // static body ? no gravity fighting the tween
      this.powerupsGroup.add(img);
      // Hovering float: animate y and keep the static body in sync via refreshBody
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
    // Gentle bob animation, sync static body each frame
    this.tweens.add({
      targets: s, y: lvl.shovel.y - 8,
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: () => { if (s.body) s.body.reset(s.x, s.y); },
    });
    // Glowing ring underneath
    const ring = this.add.circle(lvl.shovel.x, lvl.shovel.y + 10, 14, 0xf0d060, 0.25).setDepth(4);
    this.tweens.add({ targets: ring, alpha: { from: 0.1, to: 0.45 }, scale: { from: 0.85, to: 1.15 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.shovel = s;
  }

  createEnemies(lvl) {
    this.enemies = this.physics.add.group();
    lvl.enemies.forEach(p => {
      const e = this.add.sprite(p.x, p.y, 'enemy_0').setOrigin(0.5);
      e.play('enemy_wobble');
      e.setData({ minX: p.minX, maxX: p.maxX, speed: p.speed });
      this.enemies.add(e);
      this.physics.add.existing(e);
      e.body.setAllowGravity(false);
      e.body.setVelocityX(p.speed);
      e.body.setSize(26, 26);
      e.body.setOffset(11, 10);
    });
  }

  createFlyingEnemies(lvl) {
    this.flyingEnemies = this.physics.add.group();
    this.bullets       = this.physics.add.group();

    (lvl.flyingEnemies ?? []).forEach(p => {
      const fe = this.add.sprite(p.x, p.y, 'flyer_0').setOrigin(0.5);
      fe.play('flyer_flap');
      fe.setData({
        minX: p.minX, maxX: p.maxX, speed: p.speed,
        baseY: p.y,   hoverT: Math.random() * Math.PI * 2,
        shootInterval: p.shootInterval ?? 8000,
      });
      this.flyingEnemies.add(fe);
      this.physics.add.existing(fe);
      fe.body.setAllowGravity(false);
      fe.body.setVelocityX(p.speed);
      fe.body.setSize(30, 22);
      fe.body.setOffset(5, 5);

      this.time.addEvent({
        delay: p.shootInterval ?? 8000,
        loop: true,
        callback: () => {
          if (!fe.active || this.gameOver) return;
          this._flyerShoot(fe);
        },
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

    this.tweens.add({
      targets: b, alpha: { from: 1, to: 0.6 }, duration: 200, yoyo: true, repeat: -1
    });

    this.time.delayedCall(3000, () => { if (b.active) b.destroy(); });
  }

  createCounters(lvl) {
    (lvl.counters ?? []).forEach(p => {
      const sprite = this.add.image(p.x, p.y, 'counter_0').setOrigin(0.5);
      // Pulsing scale tween
      this.tweens.add({
        targets: sprite, scaleX: 1.12, scaleY: 1.12,
        duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      const counter = {
        sprite,
        count: 0,
        lastTick: 0,
        chaseSpeed: p.chaseSpeed  ?? 28,
        proximityR: p.proximityR  ?? 110,
        tickInterval: p.tickInterval ?? 333,
      };
      this.counterList.push(counter);
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

  // ?? Collisions ??????????????????????????????????????????????????????????????

  setupCollisions() {
    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.collider(this.enemies, this.platforms);

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
      if (this.playerLives < 3) {
        this.playerLives++;
        uiScene.updateLives(this.playerLives);
      }
      const heartFlash = this.add.circle(pu.x, pu.y, 28, 0xff3355, 0.7);
      this.tweens.add({ targets: heartFlash, alpha: 0, scale: 2.8, duration: 400, onComplete: () => heartFlash.destroy() });
      uiScene.showPowerupIndicator('heart', 1200);
    }
  }

  // ?? Player state ?????????????????????????????????????????????????????????????

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
      this.scene.get('UIScene').showLevelComplete(LEVELS[next].name, () => {
        this.scene.get('UIScene').scene.restart({ level: next, lives: this.playerLives });
        this.scene.restart({ level: next, lives: this.playerLives });
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

  // ?? Update ???????????????????????????????????????????????????????????????????

  update(time, delta) {
    if (this.gameOver || !this.player.active) return;

    const baseSpeed = this.hasSpeed ? 320 : 220;
    const onGround  = this.player.body.blocked.down;
    if (onGround) this.doubleJumpUsed = false;

    if (this.cursors.left.isDown) {
      this.player.body.setVelocityX(-baseSpeed);
      this.player.setFlipX(true);
      this.player.play('player_walk', true);
    } else if (this.cursors.right.isDown) {
      this.player.body.setVelocityX(baseSpeed);
      this.player.setFlipX(false);
      this.player.play('player_walk', true);
    } else {
      this.player.body.setVelocityX(0);
      if (onGround) this.player.play('player_idle', true);
    }

    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      if (onGround) {
        this.player.body.setVelocityY(-460);
        this._jumpHoldTime = 0;
        this._jumpHolding  = true;
      } else if (this.hasDoubleJump && !this.doubleJumpUsed) {
        this.doubleJumpUsed = true;
        this.player.body.setVelocityY(-430);
        this._jumpHolding = false;
        const puff = this.add.circle(this.player.x, this.player.y + 20, 10, 0x44aaff, 0.7);
        this.tweens.add({ targets: puff, alpha: 0, scale: 2.2, duration: 250, onComplete: () => puff.destroy() });
      }
    }

    // Variable jump: cut upward velocity early when key is released
    if (this._jumpHolding) {
      if (!this.cursors.up.isDown) {
        // Key released ? cut velocity to minimum jump height
        this._jumpHolding = false;
        if (this.player.body.velocity.y < -180) {
          this.player.body.setVelocityY(-180);
        }
      } else {
        this._jumpHoldTime += delta;
        // After 280ms of holding, we've hit the full arc ? stop boosting
        if (this._jumpHoldTime >= 280) this._jumpHolding = false;
      }
    }

    // Enemy patrol ? only reverse when moving toward the boundary to prevent stuck oscillation
    this.enemies.getChildren().forEach(e => {
      if (!e.active || !e.body) return;
      const minX = e.getData('minX'), maxX = e.getData('maxX'), spd = e.getData('speed');
      const vx = e.body.velocity.x;
      if (e.x <= minX && vx <= 0) { e.body.setVelocityX(spd);  e.setFlipX(false); }
      if (e.x >= maxX && vx >= 0) { e.body.setVelocityX(-spd); e.setFlipX(true);  }
    });

    // Flying enemy patrol + sinusoidal vertical hover
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

    // Counter: chase player + proximity count-up + explode at 3
    const now = this.time.now;
    const deadCounters = [];
    this.counterList.forEach(c => {
      if (!c.sprite.active) return;
      const dx = this.player.x - c.sprite.x;
      const dy = this.player.y - c.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Slowly chase the player
      if (dist > 2) {
        const nx = dx / dist;
        const ny = dy / dist;
        c.sprite.x += nx * c.chaseSpeed * (delta / 1000);
        c.sprite.y += ny * c.chaseSpeed * (delta / 1000);
      }

      // If player is in proximity, tick every tickInterval ms
      if (dist < c.proximityR && now - c.lastTick >= c.tickInterval && !this.isHurt) {
        c.lastTick = now;
        c.count = Math.min(5, c.count + 1);
        c.sprite.setTexture('counter_' + c.count);

        // Brief scale-flash to signal the tick
        this.tweens.add({
          targets: c.sprite, scaleX: 1.5, scaleY: 1.5,
          duration: 80, yoyo: true, ease: 'Power2'
        });

        if (c.count >= 5) {
          // Explode ? hurt player and destroy counter
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

    // Remove bullets that have left the world
    this.bullets.getChildren().forEach(b => {
      if (b.active && (b.x < -50 || b.x > WORLD_W + 50 || b.y < -50 || b.y > VIEW_H + 50)) {
        b.destroy();
      }
    });
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

    this.fireflyText = this.add.text(16, 16, 'Vuurvliegjes: 0 / 0', {
      fontSize: '17px', fontFamily: 'Georgia', color: '#aaffaa'
    });
    this.livesText = this.add.text(W - 16, 16, '\u2665'.repeat(this.playerLives), {
      fontSize: '20px', fontFamily: 'Georgia', color: '#ff8888'
    }).setOrigin(1, 0);

    this.add.text(W/2, 16, 'Moss & Moonlight', {
      fontSize: '19px', fontFamily: 'Georgia', color: '#88ee88', fontStyle: 'italic'
    }).setOrigin(0.5, 0);

    this.add.text(W/2, 38, `Level ${this.currentLevel+1}: ${lvl.name}`, {
      fontSize: '12px', fontFamily: 'Georgia', color: '#99aacc'
    }).setOrigin(0.5, 0);

    this.add.text(W/2, 574, '?? ? bewegen  ?  ? springen  ?  spring op vijand = verslaan', {
      fontSize: '12px', fontFamily: 'Georgia', color: '#446644'
    }).setOrigin(0.5, 0);

    this.puBar = this.add.container(14, 545);
    this.overlay = this.add.container(W/2, 280).setVisible(false);

    this.input.keyboard.on('keydown-R', () => {
      this.overlay.setVisible(false);
      this.scene.get('GameScene').scene.restart({ level: 0, lives: 3 });
      this.scene.restart({ level: 0, lives: 3 });
    });
  }

  showPowerupIndicator(type, duration) {
    this.puBar.removeAll(true);
    const colors = { double_jump: '#44aaff', speed: '#ffaa22', heart: '#ff3355' };
    const labels = { double_jump: '2? sprong', speed: 'Snelheid', heart: '? Extra leven!' };
    const color  = colors[type];
    const label  = labels[type];

    const bg  = this.add.rectangle(0, 0, 130, 22, 0x000000, 0.55).setOrigin(0, 0.5);
    const bar = this.add.rectangle(2, 0, 126, 14, Phaser.Display.Color.HexStringToColor(color).color, 0.85).setOrigin(0, 0.5);
    const txt = this.add.text(65, 0, label, { fontSize: '11px', fontFamily: 'Georgia', color }).setOrigin(0.5, 0.5);

    this.puBar.add([bg, bar, txt]);

    this.tweens.add({
      targets: bar,
      displayWidth: 0,
      duration,
      onComplete: () => this.puBar.removeAll(true)
    });
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
    this._showOverlay('Vuurvliegjes bevrijd!', '#aaffaa', `Volgende: ${nextName} ? gaat vanzelf verder`, '#88dd88', 0x66dd66);
    this.time.delayedCall(2200, cb);
  }
  showVictory() {
    this._showOverlay('Het bos straalt weer volop!', '#ffeeaa', 'Alle vijf werelden bevrijd  ?  R = opnieuw', '#ccbb88', 0xddbb44);
  }
  showLockedLevel() {
    this._showOverlay('Je vindt een mysterieuze schop...', '#f0d060', 'Level 6 is nog vergrendeld  ??  Kom later terug!', '#ccaa44', 0xb08820);
  }
  showGameOver() {
    this._showOverlay('De schaduwen hebben je gevangen...', '#ff9999', 'Druk R om opnieuw te beginnen', '#cc7777', 0xdd5555);
  }

  updateScore(collected, total) {
    this.fireflyText.setText(`Vuurvliegjes: ${collected} / ${total}`);
  }
  updateLives(lives) {
    this.livesText.setText('\u2665'.repeat(Math.max(0, lives)));
  }
}

// ??? Phaser configuration ?????????????????????????????????????????????????????
// Skipped when loaded by editor.html (which starts its own Phaser.Game with EditorScene)

if (typeof EDITOR_MODE === 'undefined') {
  fetch('levels.json')
    .then(r => r.json())
    .then(data => {
      LEVELS = data;
      new Phaser.Game({
        type: Phaser.CANVAS,
        width: VIEW_W,
        height: VIEW_H,
        parent: 'game-container',
        backgroundColor: '#060d1a',
        physics: {
          default: 'arcade',
          arcade: { gravity: { y: 750 }, debug: false }
        },
        scene: [GameScene, UIScene]
      });
    })
    .catch(err => {
      console.error('Failed to load levels.json:', err);
    });
}

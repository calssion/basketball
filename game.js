/* ============================================================
   水中投篮  –  Water Basketball
   game.js  –  Main game script (Three.js r160, custom physics)
   ============================================================ */
'use strict';

// ============================================================
// 1. CONFIGURATION
// ============================================================
const CFG = {
  TW: 8.0, TD: 3.5,
  CEIL_Y:   4.5,
  FLOOR_Y: -4.0,

  // Physics (all underwater — no water-surface transition)
  GRAVITY:     -9.8,
  BUOYANCY:    10.5,  // net upward = GRAVITY + BUOYANCY = +0.7 m/s²
  WATER_DRAG:   1.2,
  BOUNCE_DAMP:  0.42,

  // Ball
  BALL_R: 0.22,

  // Hoop (horizontal ring, flat in XZ plane)
  HOOP_Y:   2.5,
  HOOP_R:   0.34,
  HOOP_T:   0.055,
  HOOP_AMP: 1.6,   // oscillation amplitude (±x)
  HOOP_SPD: 0.65,  // default oscillation speed rad/s

  // Launch
  AIM_VX_MAX: 4.5,   // vx = mouse.nx * AIM_VX_MAX
  BALL_START_Y: -3.72, // = FLOOR_Y + BALL_R + 0.08

  // Gameplay
  TOTAL_BALLS: 20,
  ROUND_TIME:  90,
  MAX_POWER:   14,
  MIN_POWER:    8,
  CHARGE_DUR:   1.6,

  // AI trajectory
  TRAJ_STEPS: 200,
  TRAJ_DT:    0.05,

  // Difficulty
  DIFF: {
    easy:   { scatter: 0.04, hoopSpd: 0.35 },
    medium: { scatter: 0.09, hoopSpd: 0.70 },
    hard:   { scatter: 0.17, hoopSpd: 1.30 },
  },
};

// ============================================================
// 2. GLOBALS
// ============================================================
let renderer, scene, camera, clock;
let waterUniforms;
let hoopGroup = null;    // hoop THREE.Group
let hoopT = 0;           // oscillation time
let aimDiscMesh = null;  // aim indicator disc at hoop level
let trajLine, trajPositions;
let bubblePositions, bubbleSpeeds, bubbleSystem;
let ball = null;         // current active Ball instance
let particles = [];
const mouse = { x: 0, y: 0, nx: 0, ny: 0 };
let charging = false;
let chargeT  = 0;
let aimX = 0;            // -1..1 horizontal aim
let currentVec = new THREE.Vector3(0, 0, 0);

const GS = {
  phase: 'start', score: 0, ballsLeft: CFG.TOTAL_BALLS,
  timeLeft: CFG.ROUND_TIME, combo: 0,
  highScore: Number(localStorage.getItem('basketballHigh') || 0),
  aiAssist: false, difficulty: 'medium', timerID: null,
  waitingToShoot: true,
  totalThrown: 0, totalScored: 0,
};

// ============================================================
// 3. WATER SHADERS (reused verbatim from original game)
// ============================================================
const waterVert = /* glsl */`
  uniform float uTime;
  varying vec2  vUv;
  varying float vWave;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w  = sin(p.x * 2.8 + uTime * 1.4) * 0.07
             + sin(p.z * 3.1 - uTime * 1.1) * 0.05
             + sin((p.x + p.z) * 5.0 + uTime * 2.2) * 0.018;
    p.y += w;
    vWave = w;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const waterFrag = /* glsl */`
  uniform float uTime;
  varying vec2  vUv;
  varying float vWave;
  void main() {
    float cx = sin(vUv.x * 9.0 + uTime) * sin(vUv.y * 9.0 - uTime * 0.7)
             + sin(vUv.x * 14.0 - uTime * 0.4) * sin(vUv.y * 14.0 + uTime);
    float caustic = clamp(cx * 0.12 + 0.88, 0.7, 1.15);
    vec3  wCol = vec3(0.08, 0.38, 0.62) * caustic;
    float foam  = smoothstep(0.04, 0.08, abs(vWave));
    wCol = mix(wCol, vec3(0.55, 0.80, 0.95), foam * 0.35);
    float alpha = 0.62 + foam * 0.18 + clamp(vWave * 3.0, 0.0, 0.10);
    gl_FragColor = vec4(wCol, alpha);
  }
`;

// ============================================================
// 4. SCENE / RENDERER SETUP
// ============================================================
function initThree() {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('game-canvas'),
    antialias: true,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040d1c);
  scene.fog = new THREE.FogExp2(0x0a3a5a, 0.018);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 120);
  camera.position.set(0, 0, 11);
  camera.lookAt(0, 0, 0);

  clock = new THREE.Clock();

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function createLights() {
  /* Soft ambient — deep-water blue */
  scene.add(new THREE.AmbientLight(0x204060, 1.8));

  /* Directional from above-front */
  const sun = new THREE.DirectionalLight(0x88ccff, 2.4);
  sun.position.set(0, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left   = -8;
  sun.shadow.camera.right  =  8;
  sun.shadow.camera.top    =  8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.far    = 40;
  scene.add(sun);

  /* Underwater fill lights */
  const u1 = new THREE.PointLight(0x0066aa, 1.8, 14);
  u1.position.set(-3, -1, 0);
  scene.add(u1);

  const u2 = new THREE.PointLight(0x0044cc, 1.5, 14);
  u2.position.set(3, -1, 0);
  scene.add(u2);
}

// ============================================================
// 5. TANK
// ============================================================
function createTank() {
  const TW = CFG.TW, TD = CFG.TD;
  const TH = CFG.CEIL_Y - CFG.FLOOR_Y;  // 8.5
  const cy = CFG.FLOOR_Y + TH / 2;      // centre Y = 0.25

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.08,
    roughness: 0.05,
    metalness: 0.0,
    transmission: 0.85,
    thickness: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x55aadd, transparent: true, opacity: 0.5,
  });

  /* 4 vertical glass panels (no top) */
  const sidePanels = [
    [0,    cy, -TD / 2,  0,          TW, TH],  // back
    [0,    cy,  TD / 2,  0,          TW, TH],  // front
    [-TW / 2, cy, 0,  Math.PI / 2,   TD, TH],  // left
    [ TW / 2, cy, 0,  Math.PI / 2,   TD, TH],  // right
  ];
  sidePanels.forEach(([x, y, z, ry, w, h]) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(g, glassMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    scene.add(m);
  });

  /* Bottom floor panel */
  const floorPanel = new THREE.Mesh(new THREE.PlaneGeometry(TW, TD), glassMat);
  floorPanel.rotation.x = -Math.PI / 2;
  floorPanel.position.set(0, CFG.FLOOR_Y, 0);
  scene.add(floorPanel);

  /* LineSegments wireframe outline */
  const boxGeo = new THREE.BoxGeometry(TW, TH, TD);
  const edges  = new THREE.EdgesGeometry(boxGeo);
  const frame  = new THREE.LineSegments(edges, edgeMat);
  frame.position.set(0, cy, 0);
  scene.add(frame);
}

// ============================================================
// 6. WATER CAP  (animated surface at top of tank)
// ============================================================
function createWaterCap() {
  waterUniforms = { uTime: { value: 0 } };
  const geo = new THREE.PlaneGeometry(CFG.TW - 0.02, CFG.TD - 0.02, 40, 20);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader:   waterVert,
    fragmentShader: waterFrag,
    uniforms:       waterUniforms,
    transparent:    true,
    depthWrite:     false,
    side:           THREE.FrontSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = CFG.CEIL_Y - 0.3;
  mesh.renderOrder = 1;
  scene.add(mesh);
}

// ============================================================
// 7. FLOOR  (sandy bottom, rocks, seaweed)
// ============================================================
function createFloor() {
  const TW = CFG.TW, TD = CFG.TD, FY = CFG.FLOOR_Y;

  /* Sand */
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(TW - 0.2, TD - 0.2, 20, 14),
    new THREE.MeshStandardMaterial({
      color: 0x8a7040, roughness: 0.95, metalness: 0.0,
      emissive: 0x1a1005, emissiveIntensity: 0.5,
    })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = FY + 0.01;
  sand.receiveShadow = true;
  scene.add(sand);

  /* Small random rocks */
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x556055, roughness: 0.9 });
  for (let i = 0; i < 14; i++) {
    const r = 0.05 + Math.random() * 0.12;
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 5), rockMat);
    m.position.set(
      (Math.random() - 0.5) * (TW - 1.0),
      FY + r * 0.5,
      (Math.random() - 0.5) * (TD - 0.8)
    );
    m.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(m);
  }

  /* Seaweed clusters */
  const swMat = new THREE.MeshStandardMaterial({
    color: 0x1a6a2a, emissive: 0x081a08, emissiveIntensity: 0.4,
  });
  for (let i = 0; i < 6; i++) {
    const cx = (Math.random() - 0.5) * (TW - 1.0);
    const cz = (Math.random() - 0.5) * (TD - 0.6);
    for (let seg = 0; seg < 4; seg++) {
      const sw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.035, 0.5 + Math.random() * 0.5, 4),
        swMat
      );
      sw.position.set(
        cx + (Math.random() - 0.5) * 0.25,
        FY + 0.28 + seg * 0.50,
        cz + (Math.random() - 0.5) * 0.25
      );
      sw.rotation.z = (Math.random() - 0.5) * 0.35;
      scene.add(sw);
    }
  }
}

// ============================================================
// 8. HOOP ASSEMBLY + BACKBOARD
// ============================================================
function createHoop() {
  hoopGroup = new THREE.Group();
  hoopGroup.position.set(0, CFG.HOOP_Y, 0);

  /* Orange torus — flat horizontal (rotation.x = PI/2) */
  const hoopGeo = new THREE.TorusGeometry(CFG.HOOP_R, CFG.HOOP_T, 12, 40);
  const hoopMat = new THREE.MeshStandardMaterial({
    color: 0xff6600, roughness: 0.5, metalness: 0.3,
    emissive: 0xff4400, emissiveIntensity: 0.2,
  });
  const hoopMesh = new THREE.Mesh(hoopGeo, hoopMat);
  hoopMesh.rotation.x = Math.PI / 2;
  hoopGroup.add(hoopMesh);   // children[0] — used by flashHoop()

  /* White wireframe net — tapered cylinder */
  const netGeo = new THREE.CylinderGeometry(
    CFG.HOOP_R * 0.9, CFG.HOOP_R * 0.35, 0.55, 8, 1, true
  );
  const netMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, wireframe: true, transparent: true,
    opacity: 0.45, depthWrite: false,
  });
  const netMesh = new THREE.Mesh(netGeo, netMat);
  netMesh.position.y = -0.28;
  hoopGroup.add(netMesh);

  /* Support arm — thin cylinder from back of hoop ring toward back wall */
  const armLen = CFG.TD / 2 - CFG.HOOP_R - 0.05;
  const armGeo = new THREE.CylinderGeometry(0.025, 0.025, armLen, 6);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.7, roughness: 0.3 });
  const armMesh = new THREE.Mesh(armGeo, armMat);
  armMesh.rotation.x = Math.PI / 2;
  armMesh.position.set(0, 0, -(CFG.HOOP_R + armLen / 2));
  hoopGroup.add(armMesh);

  scene.add(hoopGroup);

  /* ── Static backboard ─────────────────────────── */
  const BOARD_W = 2.2, BOARD_H = 1.1;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.06),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.4, metalness: 0.0,
      transparent: true, opacity: 0.88,
    })
  );
  board.position.set(0, CFG.HOOP_Y + 0.55, -CFG.TD / 2 + 0.12);
  scene.add(board);

  /* Red inner-rectangle edge lines on the backboard */
  const iW = 1.2, iH = 0.5, bz = -CFG.TD / 2 + 0.15;
  const rectPts = new Float32Array([
    -iW/2, CFG.HOOP_Y + 0.55 - iH/2, bz,
     iW/2, CFG.HOOP_Y + 0.55 - iH/2, bz,
     iW/2, CFG.HOOP_Y + 0.55 + iH/2, bz,
    -iW/2, CFG.HOOP_Y + 0.55 + iH/2, bz,
    -iW/2, CFG.HOOP_Y + 0.55 - iH/2, bz,  // close loop
  ]);
  const rectGeo = new THREE.BufferGeometry();
  rectGeo.setAttribute('position', new THREE.BufferAttribute(rectPts, 3));
  scene.add(new THREE.Line(rectGeo, new THREE.LineBasicMaterial({ color: 0xff2222 })));
}

// ============================================================
// 9. BUBBLE SYSTEM  (180 points, full tank height)
// ============================================================
function createBubbleSystem() {
  const count = 180;
  bubblePositions = new Float32Array(count * 3);
  bubbleSpeeds    = new Float32Array(count);
  const tankH = CFG.CEIL_Y - CFG.FLOOR_Y;

  for (let i = 0; i < count; i++) {
    bubblePositions[i * 3]     = (Math.random() - 0.5) * (CFG.TW - 0.4);
    bubblePositions[i * 3 + 1] = CFG.FLOOR_Y + Math.random() * tankH;
    bubblePositions[i * 3 + 2] = (Math.random() - 0.5) * (CFG.TD - 0.4);
    bubbleSpeeds[i] = 0.3 + Math.random() * 0.7;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(bubblePositions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaaddff, size: 0.07, transparent: true, opacity: 0.55,
    sizeAttenuation: true, depthWrite: false,
  });
  bubbleSystem = new THREE.Points(geo, mat);
  scene.add(bubbleSystem);
}

function updateBubbles(dt) {
  const count = bubblePositions.length / 3;
  for (let i = 0; i < count; i++) {
    bubblePositions[i * 3 + 1] += bubbleSpeeds[i] * dt;
    if (bubblePositions[i * 3 + 1] > CFG.CEIL_Y) {
      bubblePositions[i * 3]     = (Math.random() - 0.5) * (CFG.TW - 0.5);
      bubblePositions[i * 3 + 1] = CFG.FLOOR_Y + Math.random() * 0.3;
      bubblePositions[i * 3 + 2] = (Math.random() - 0.5) * (CFG.TD - 0.5);
    }
  }
  bubbleSystem.geometry.attributes.position.needsUpdate = true;
}

// ============================================================
// 10. AIM INDICATOR + TRAJECTORY LINE
// ============================================================
function createAimIndicator() {
  const geo = new THREE.RingGeometry(0.14, 0.28, 32);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false,
  });
  aimDiscMesh = new THREE.Mesh(geo, mat);
  aimDiscMesh.rotation.x = -Math.PI / 2;
  aimDiscMesh.position.set(0, CFG.HOOP_Y + 0.02, 0);
  aimDiscMesh.visible = false;
  scene.add(aimDiscMesh);
}

function createTrajectoryLine() {
  const maxPts = CFG.TRAJ_STEPS + 1;
  trajPositions = new Float32Array(maxPts * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color: 0x00ffcc, transparent: true, opacity: 0.7, depthWrite: false,
  });
  trajLine = new THREE.Line(geo, mat);
  trajLine.renderOrder = 2;
  trajLine.visible = false;
  scene.add(trajLine);
}

// ============================================================
// 11. BASKETBALL TEXTURE HELPER
// ============================================================
function makeBasketballTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');

  /* Orange base */
  ctx.fillStyle = '#e06020';
  ctx.fillRect(0, 0, 256, 256);

  /* Black seam lines — two horizontal + two vertical bezier arcs */
  ctx.strokeStyle = '#1a0800';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';

  ctx.beginPath(); ctx.moveTo(0, 128);
  ctx.bezierCurveTo(64, 92, 192, 92, 256, 128);
  ctx.stroke();

  ctx.beginPath(); ctx.moveTo(0, 128);
  ctx.bezierCurveTo(64, 164, 192, 164, 256, 128);
  ctx.stroke();

  ctx.beginPath(); ctx.moveTo(128, 0);
  ctx.bezierCurveTo(92, 64, 92, 192, 128, 256);
  ctx.stroke();

  ctx.beginPath(); ctx.moveTo(128, 0);
  ctx.bezierCurveTo(164, 64, 164, 192, 128, 256);
  ctx.stroke();

  return new THREE.CanvasTexture(canvas);
}

// ============================================================
// 12. BALL CLASS
// ============================================================
class Ball {
  /** @param {number} vx  @param {number} vy  @param {number} vz */
  constructor(vx, vy, vz = 0) {
    this.pos    = new THREE.Vector3(0, CFG.BALL_START_Y, 0);
    this.vel    = new THREE.Vector3(vx, vy, vz);
    this.prevY  = CFG.BALL_START_Y;
    this.scored = false;
    this.alive  = true;
    this.age    = 0;

    this._tex = makeBasketballTexture();
    const geo = new THREE.SphereGeometry(CFG.BALL_R, 18, 14);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe06020, roughness: 0.70, map: this._tex,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  /** True when ball has been around long enough and is moving slowly */
  get settled() {
    return this.age > 2.5 && this.vel.length() < 0.5;
  }

  update(dt) {
    if (!this.alive) return;
    this.age   += dt;
    this.prevY  = this.pos.y;

    /* ── Physics (always underwater) ── */

    // Net buoyancy (+0.7 m/s² upward)
    this.vel.y += (CFG.GRAVITY + CFG.BUOYANCY) * dt;

    // Linear water drag
    const speed = this.vel.length();
    if (speed > 0.001) {
      const drag = Math.min(CFG.WATER_DRAG * speed * dt, speed);
      this.vel.addScaledVector(this.vel, -drag / speed);
    }

    // Water current
    this.vel.x += currentVec.x * dt;
    this.vel.z += currentVec.z * dt;

    // Integrate position
    this.pos.addScaledVector(this.vel, dt);

    /* ── Boundary collisions ── */

    // Floor
    if (this.pos.y < CFG.FLOOR_Y + CFG.BALL_R) {
      this.pos.y  = CFG.FLOOR_Y + CFG.BALL_R;
      this.vel.y  = Math.abs(this.vel.y) * CFG.BOUNCE_DAMP;
      this.vel.x *= CFG.BOUNCE_DAMP;
      this.vel.z *= CFG.BOUNCE_DAMP;
      spawnBounceParticle(this.pos.x, this.pos.y, this.pos.z);
    }

    // Ceiling
    if (this.pos.y > CFG.CEIL_Y - CFG.BALL_R) {
      this.pos.y = CFG.CEIL_Y - CFG.BALL_R;
      this.vel.y = -Math.abs(this.vel.y) * CFG.BOUNCE_DAMP;
    }

    // Side walls (±X)
    const hw = CFG.TW / 2 - CFG.BALL_R;
    if (Math.abs(this.pos.x) > hw) {
      this.pos.x  = Math.sign(this.pos.x) * hw;
      this.vel.x *= -CFG.BOUNCE_DAMP;
      spawnBounceParticle(this.pos.x, this.pos.y, this.pos.z);
    }

    // Front/back walls (±Z)
    const hd = CFG.TD / 2 - CFG.BALL_R;
    if (Math.abs(this.pos.z) > hd) {
      this.pos.z  = Math.sign(this.pos.z) * hd;
      this.vel.z *= -CFG.BOUNCE_DAMP;
    }

    /* ── Score check FIRST: ball crosses HOOP_Y going upward ── */
    if (!this.scored && this.vel.y > 0 &&
        this.prevY < CFG.HOOP_Y && this.pos.y >= CFG.HOOP_Y) {
      const dx = this.pos.x - hoopGroup.position.x;
      const dz = this.pos.z - hoopGroup.position.z;
      const dist2D = Math.sqrt(dx * dx + dz * dz);
      if (dist2D < CFG.HOOP_R - CFG.BALL_R * 0.4) {
        onBallScored();
        this.scored = true;
      }
    }

    /* ── Hoop rim collision (only if not already scored) ── */
    if (!this.scored && Math.abs(this.pos.y - CFG.HOOP_Y) < CFG.BALL_R + CFG.HOOP_T * 2.5) {
      const dx = this.pos.x - hoopGroup.position.x;
      const dz = this.pos.z - hoopGroup.position.z;
      const distFromCenter = Math.sqrt(dx * dx + dz * dz);
      const rimDist = Math.abs(distFromCenter - CFG.HOOP_R);
      if (rimDist < CFG.BALL_R + CFG.HOOP_T) {
        const len = distFromCenter || 1;
        const nx = dx / len, nz = dz / len;
        const dot = this.vel.x * nx + this.vel.z * nz;
        this.vel.x  = (this.vel.x - 2 * dot * nx) * CFG.BOUNCE_DAMP;
        this.vel.z  = (this.vel.z - 2 * dot * nz) * CFG.BOUNCE_DAMP;
        // The rim is horizontal — do NOT damp vertical velocity so the ball can
        // still rise through the hoop after a glancing rim contact.
        spawnBounceParticle(this.pos.x, this.pos.y, this.pos.z);
      }
    }

    /* ── Mesh sync + rotation ── */
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.x += this.vel.z * dt * 0.8;
    this.mesh.rotation.z -= this.vel.x * dt * 0.8;
  }

  dispose() {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    if (this._tex) this._tex.dispose();
    this.alive = false;
  }
}

// ============================================================
// 13. PARTICLES  (bounce / splash feedback)
// ============================================================
class Particle {
  constructor(x, y, z) {
    this.pos  = new THREE.Vector3(x, y, z);
    this.vel  = new THREE.Vector3(
      (Math.random() - 0.5) * 2.0,
      0.6 + Math.random() * 1.4,
      (Math.random() - 0.5) * 2.0
    );
    this.life  = 1.0;
    this.decay = 1.2 + Math.random() * 0.8;

    const r   = 0.03 + Math.random() * 0.05;
    const geo = new THREE.SphereGeometry(r, 4, 3);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x88ccee, transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  update(dt) {
    this.vel.y  -= 4 * dt;  // gentle drag in water
    this.pos.addScaledVector(this.vel, dt);
    this.life   -= this.decay * dt;
    this.mesh.position.copy(this.pos);
    this.mesh.material.opacity = Math.max(0, this.life * 0.7);
    return this.life > 0 && this.pos.y > CFG.FLOOR_Y;
  }

  dispose() {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function spawnBounceParticle(x, y, z) {
  const count = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, z));
  }
}

// ============================================================
// 14. INPUT HANDLING
// ============================================================
function setupInput() {
  const canvas = renderer.domElement;

  canvas.addEventListener('mousemove',  onMouseMove, false);
  canvas.addEventListener('mousedown',  onMouseDown, false);
  canvas.addEventListener('mouseup',    onMouseUp,   false);
  canvas.addEventListener('mouseleave', () => {
    if (aimDiscMesh) aimDiscMesh.visible = false;
  }, false);

  /* Touch support */
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.touches[0];
    onMouseMove({ clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    onMouseMove({ clientX: t.clientX, clientY: t.clientY });
    onMouseDown();
  }, { passive: false });
  canvas.addEventListener('touchend', onMouseUp, false);
}

function onMouseMove(e) {
  mouse.nx = (e.clientX / innerWidth)  * 2 - 1;
  mouse.ny = -(e.clientY / innerHeight) * 2 + 1;
  mouse.x  = e.clientX;
  mouse.y  = e.clientY;

  aimX = mouse.nx;

  if (GS.phase !== 'playing' || !GS.waitingToShoot) return;

  /* Move aim disc: rough horizontal mapping, clamped to tank walls */
  const rawX    = aimX * CFG.AIM_VX_MAX * 0.25;
  const clampedX = Math.max(-(CFG.TW / 2 - CFG.BALL_R),
                    Math.min(CFG.TW / 2 - CFG.BALL_R, rawX));
  aimDiscMesh.position.set(clampedX, CFG.HOOP_Y + 0.02, 0);
  aimDiscMesh.visible = true;

  if (GS.aiAssist) updateTrajectoryLine();
}

function onMouseDown() {
  if (GS.phase !== 'playing') return;
  if (!GS.waitingToShoot || GS.ballsLeft <= 0) return;
  charging = true;
  chargeT  = 0;
}

function onMouseUp() {
  if (!charging) return;
  charging = false;
  if (GS.phase !== 'playing' || !GS.waitingToShoot || GS.ballsLeft <= 0) return;
  const power = CFG.MIN_POWER + (CFG.MAX_POWER - CFG.MIN_POWER) * chargeT;
  doThrow(aimX * CFG.AIM_VX_MAX, power);
}

// ============================================================
// 15. THROW & TRAJECTORY
// ============================================================
function doThrow(vx, power) {
  const diff = CFG.DIFF[GS.difficulty];
  const sx   = (Math.random() - 0.5) * diff.scatter * 2;
  const sz   = (Math.random() - 0.5) * diff.scatter;
  ball = new Ball(vx + sx, power, sz);
  GS.ballsLeft--;
  GS.totalThrown++;
  GS.waitingToShoot = false;
  updateHUD();
  if (trajLine)    trajLine.visible    = false;
  if (aimDiscMesh) aimDiscMesh.visible = false;
}

/**
 * Simulate ball trajectory from BALL_START_Y.
 * Returns array of {x, y, z}.
 */
function simulateTrajectory(vx, vy) {
  const pts = [];
  let px = 0, py = CFG.BALL_START_Y, pz = 0;
  let lvx = vx, lvy = vy, lvz = 0;
  const dt = CFG.TRAJ_DT;

  for (let i = 0; i <= CFG.TRAJ_STEPS; i++) {
    pts.push({ x: px, y: py, z: pz });

    lvy += (CFG.GRAVITY + CFG.BUOYANCY) * dt;

    const spd = Math.sqrt(lvx * lvx + lvy * lvy + lvz * lvz);
    if (spd > 0.001) {
      const drag = Math.min(CFG.WATER_DRAG * spd * dt, spd);
      lvx -= (lvx / spd) * drag;
      lvy -= (lvy / spd) * drag;
      lvz -= (lvz / spd) * drag;
    }

    lvx += currentVec.x * dt;
    lvz += currentVec.z * dt;

    px += lvx * dt;
    py += lvy * dt;
    pz += lvz * dt;

    if (py >= CFG.CEIL_Y - CFG.BALL_R) break;
    if (py <= CFG.FLOOR_Y + CFG.BALL_R) break;
    if (Math.abs(px) >= CFG.TW / 2 - CFG.BALL_R) break;
  }
  return pts;
}

/** Recompute and display the trajectory preview line. */
function updateTrajectoryLine() {
  if (GS.phase !== 'playing') { trajLine.visible = false; return; }

  const power = charging
    ? CFG.MIN_POWER + (CFG.MAX_POWER - CFG.MIN_POWER) * chargeT
    : CFG.MIN_POWER + (CFG.MAX_POWER - CFG.MIN_POWER) * 0.5;

  const pts = simulateTrajectory(aimX * CFG.AIM_VX_MAX, power);

  let idx = 0;
  pts.forEach(p => {
    trajPositions[idx++] = p.x;
    trajPositions[idx++] = p.y;
    trajPositions[idx++] = p.z;
  });
  trajLine.geometry.attributes.position.needsUpdate = true;
  trajLine.geometry.setDrawRange(0, pts.length);
  trajLine.visible = true;
}

// ============================================================
// 16. AI SYSTEM
// ============================================================

/**
 * AI auto-throw: find vx to land ball at hoop x, then throw after 500 ms.
 * Accounts for hoop movement during the ball's flight time.
 */
function aiAutoThrow() {
  if (GS.phase !== 'playing' || GS.ballsLeft <= 0 || !GS.waitingToShoot) return;

  const power = CFG.MIN_POWER + (CFG.MAX_POWER - CFG.MIN_POWER) * 0.6;

  /* Estimate flight time to HOOP_Y using a vertical-only simulation */
  const pts0 = simulateTrajectory(0, power);
  let flightTime = 0.8; // fallback
  for (let i = 0; i < pts0.length; i++) {
    if (pts0[i].y >= CFG.HOOP_Y) { flightTime = (i + 1) * CFG.TRAJ_DT; break; }
  }

  /* Predict where the hoop will be when the ball arrives.
   * hoopSpdRad = actual angular speed in rad/s; CFG.HOOP_SPD is the baseline
   * value for difficulty 'medium' (hoopSpd factor = 0.65 for medium). */
  const hoopSpdRad = CFG.HOOP_SPD * CFG.DIFF[GS.difficulty].hoopSpd / 0.65;
  const predictedHoopX = Math.sin(hoopT + hoopSpdRad * (flightTime + 0.5)) * CFG.HOOP_AMP;
  let targetX = predictedHoopX;

  /* Iterative refinement of vx.
   * Starting guess ~2× target accounts for water drag (ball travels ~half
   * the distance its vx "would" cover in free flight). Each iteration corrects
   * the x error at hoop height; 8 iterations give < 0.02 unit accuracy. */
  let vx = targetX * 2.0;
  for (let iter = 0; iter < 8; iter++) {
    const pts = simulateTrajectory(vx, power);
    let closest = null, minD = Infinity;
    for (const p of pts) {
      const d = Math.abs(p.y - CFG.HOOP_Y);
      if (d < minD) { minD = d; closest = p; }
    }
    if (!closest) break;
    const errX = targetX - closest.x;
    if (Math.abs(errX) < 0.02) break;  // converged
    vx += errX * 0.85;
  }

  /* Add difficulty scatter */
  const diff = CFG.DIFF[GS.difficulty];
  vx += (Math.random() - 0.5) * diff.scatter * 2;
  vx  = Math.max(-CFG.AIM_VX_MAX, Math.min(CFG.AIM_VX_MAX, vx));

  /* Update global aim */
  aimX = vx / CFG.AIM_VX_MAX;

  /* Show aim disc briefly */
  const discX = Math.max(-(CFG.TW / 2 - CFG.BALL_R),
                  Math.min(CFG.TW / 2 - CFG.BALL_R, aimX * CFG.AIM_VX_MAX * 0.25));
  aimDiscMesh.position.set(discX, CFG.HOOP_Y + 0.02, 0);
  aimDiscMesh.visible = true;

  if (GS.aiAssist) updateTrajectoryLine();

  setTimeout(() => {
    if (GS.phase === 'playing' && GS.waitingToShoot) doThrow(vx, power);
  }, 500);
}

// ============================================================
// 17. GAME LOGIC
// ============================================================
function onBallScored() {
  GS.combo++;
  const mult = Math.min(GS.combo, 5);
  const gain = 1 * mult;
  GS.score += gain;
  GS.totalScored++;

  /* Floating score at ball's projected screen position */
  if (ball) {
    const sv = ball.pos.clone().project(camera);
    const sx = (sv.x * 0.5 + 0.5) * innerWidth;
    const sy = (1 - (sv.y * 0.5 + 0.5)) * innerHeight;
    showFloatingScore('+' + gain, sx, sy);
  }

  flashHoop();

  /* Screen flash */
  const flash = document.getElementById('hit-flash');
  flash.classList.remove('flash');
  void flash.offsetWidth;
  flash.classList.add('flash');

  /* Combo popup */
  if (GS.combo >= 2) {
    const el = document.getElementById('combo-popup');
    el.textContent = mult + '× COMBO!';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  updateHUD();
}

/** Briefly flash the hoop ring orange-bright. */
function flashHoop() {
  if (!hoopGroup || hoopGroup.children.length === 0) return;
  const hoopMesh = hoopGroup.children[0];
  if (!hoopMesh.material) return;
  hoopMesh.material.emissiveIntensity = 1.4;
  setTimeout(() => { hoopMesh.material.emissiveIntensity = 0.2; }, 400);
}

/** Show a gold floating score label at screen coordinates. */
function showFloatingScore(text, sx, sy) {
  const el = document.createElement('div');
  el.className  = 'score-float';
  el.textContent = text;
  el.style.left  = sx + 'px';
  el.style.top   = sy + 'px';
  el.style.color = '#ffd700';
  document.getElementById('ui').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function startGame() {
  /* Sync difficulty from start-screen selector */
  const startDiff = document.getElementById('diff-select-start');
  if (startDiff) {
    GS.difficulty = startDiff.value;
    document.getElementById('diff-select').value = GS.difficulty;
  }

  GS.phase          = 'playing';
  GS.score          = 0;
  GS.ballsLeft      = CFG.TOTAL_BALLS;
  GS.timeLeft       = CFG.ROUND_TIME;
  GS.combo          = 0;
  GS.waitingToShoot = true;
  GS.totalThrown    = 0;
  GS.totalScored    = 0;
  hoopT = 0;

  /* Clear any active ball */
  if (ball) { ball.dispose(); ball = null; }

  /* Clear particles */
  particles.forEach(p => p.dispose());
  particles = [];

  /* Random water current — magnitude scaled by hoopSpd */
  const diff   = CFG.DIFF[GS.difficulty];
  const cScale = diff.hoopSpd * 0.6;
  const angle  = Math.random() * Math.PI * 2;
  const mag    = cScale * (0.4 + Math.random() * 0.6);
  currentVec.set(Math.cos(angle) * mag, 0, Math.sin(angle) * mag);
  updateCurrentIndicator();

  /* Show aim disc */
  if (aimDiscMesh) aimDiscMesh.visible = true;

  /* Screen management */
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');

  updateHUD();

  /* Countdown timer */
  clearInterval(GS.timerID);
  GS.timerID = setInterval(() => {
    GS.timeLeft--;
    updateHUD();
    if (GS.timeLeft <= 0) endGame();
  }, 1000);
}

function endGame() {
  GS.phase = 'gameover';
  clearInterval(GS.timerID);

  if (aimDiscMesh) aimDiscMesh.visible = false;
  if (trajLine)    trajLine.visible    = false;
  charging = false;

  if (GS.score > GS.highScore) {
    GS.highScore = GS.score;
    localStorage.setItem('basketballHigh', GS.highScore);
  }

  document.getElementById('final-score').textContent     = GS.score;
  document.getElementById('hi-score-go').textContent     = GS.highScore;
  document.getElementById('go-rings-thrown').textContent = GS.totalThrown;
  document.getElementById('go-rings-hit').textContent    = GS.totalScored;
  document.getElementById('gameover-screen').classList.remove('hidden');
}

function updateHUD() {
  document.getElementById('hud-score-val').textContent = GS.score;
  document.getElementById('hud-timer-val').textContent = GS.timeLeft;
  document.getElementById('hud-rings-val').textContent = GS.ballsLeft;
  document.getElementById('hud-hi-val').textContent    = GS.highScore;
}

function updateCurrentIndicator() {
  const el = document.getElementById('current-arrow');
  if (!el) return;
  const angle = Math.atan2(currentVec.z, currentVec.x) * 180 / Math.PI;
  el.style.transform = `rotate(${angle}deg)`;
  const mag = currentVec.length();
  el.style.opacity   = 0.4 + mag * 0.4;
}

// ============================================================
// 18. UI WIRING
// ============================================================
function wireUI() {
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);

  const aiAssistBtn = document.getElementById('btn-ai-assist');
  aiAssistBtn.addEventListener('click', () => {
    GS.aiAssist = !GS.aiAssist;
    aiAssistBtn.classList.toggle('active', GS.aiAssist);
    if (!GS.aiAssist && trajLine) trajLine.visible = false;
  });

  document.getElementById('btn-ai-throw').addEventListener('click', aiAutoThrow);

  document.getElementById('diff-select').addEventListener('change', e => {
    GS.difficulty = e.target.value;
  });
}

// ============================================================
// 19. ANIMATION LOOP
// ============================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  /* Animated water cap */
  if (waterUniforms) waterUniforms.uTime.value += dt;

  /* Rising bubbles */
  updateBubbles(dt);

  if (GS.phase === 'playing') {
    /* ── Hoop oscillation ── */
    const hoopSpd = CFG.HOOP_SPD * CFG.DIFF[GS.difficulty].hoopSpd / 0.65;
    hoopT += dt * hoopSpd;
    hoopGroup.position.x = Math.sin(hoopT) * CFG.HOOP_AMP;

    /* ── Charge bar ── */
    if (charging) {
      chargeT = Math.min(chargeT + dt / CFG.CHARGE_DUR, 1.0);
      document.getElementById('power-bar-inner').style.width = (chargeT * 100) + '%';
      document.getElementById('power-bar-wrap').classList.add('active');
      updateTrajectoryLine(); // always show trajectory while charging
    } else {
      document.getElementById('power-bar-wrap').classList.remove('active');
      /* Show trajectory if AI assist is on and waiting to shoot */
      if (GS.aiAssist && GS.waitingToShoot) {
        updateTrajectoryLine();
      } else if (trajLine && !GS.aiAssist) {
        trajLine.visible = false;
      }
    }

    /* ── Aim disc pulsing ── */
    if (aimDiscMesh && aimDiscMesh.visible) {
      const t = waterUniforms ? waterUniforms.uTime.value : 0;
      aimDiscMesh.material.opacity = 0.38 + Math.sin(t * 3.5) * 0.15;
    }

    /* ── Ball update ── */
    if (ball) {
      ball.update(dt);

      /* Combo reset: ball is descending past hoop, not scored */
      if (ball.alive && ball.age > 1.5 && !ball.scored &&
          ball.pos.y < CFG.HOOP_Y - 0.3 && ball.vel.y < 0) {
        GS.combo = 0;
      }

      /* Reset conditions: scored (brief delay) OR settled OR hard timeout */
      const readyToReset = (ball.scored && ball.age > 1.5)
                        || ball.settled
                        || ball.age > 7.0;

      if (readyToReset) {
        ball.dispose();
        ball = null;
        GS.waitingToShoot = true;
        if (aimDiscMesh) aimDiscMesh.visible = true;

        if (GS.ballsLeft <= 0) {
          /* All balls used — end game after brief delay */
          setTimeout(() => { if (GS.phase === 'playing') endGame(); }, 2000);
        }
      }
    }
  }

  /* ── Particle updates ── */
  for (let i = particles.length - 1; i >= 0; i--) {
    if (!particles[i].update(dt)) {
      particles[i].dispose();
      particles.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

// ============================================================
// 20. BOOTSTRAP
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  createLights();
  createTank();
  createWaterCap();
  createFloor();
  createHoop();
  createBubbleSystem();
  createAimIndicator();
  createTrajectoryLine();
  setupInput();
  wireUI();
  animate();
});

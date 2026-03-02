/* ============================================================
   水中套圈  –  Underwater Ring Toss
   game.js  –  Main game script (Three.js, custom physics)
   ============================================================ */
'use strict';

// ============================================================
// 1. CONFIGURATION
// ============================================================
const CFG = {
  /* Tank (world units, centred at origin, Y-up) */
  TW: 10, TH: 7, TD: 5.5,
  WATER_Y:  1.2,   // water-surface plane y
  FLOOR_Y: -3.5,   // tank bottom y

  /* Physics */
  GRAVITY:    -9.8,
  BUOYANCY:    6.5,   // reduced so rings sink in ~5s rather than ~12s
  WATER_DRAG:  4.5,
  ENTRY_DAMP:  0.55,   // velocity multiplier on water-surface impact
  BOUNCE_DAMP: 0.25,   // ring-vs-wall restitution

  /* Ring */
  RING_R: 0.55,  // torus major radius
  RING_T: 0.06,  // torus tube radius

  /* Peg */
  PEG_R: 0.09,
  PEG_H: 0.85,

  /* Gameplay */
  TOTAL_RINGS: 20,
  ROUND_TIME:  90,    // seconds
  MAX_POWER:   14,    // m/s max drop speed
  MIN_POWER:    2,
  CHARGE_DUR:   1.6,  // s to reach max charge
  /* AI trajectory preview */
  TRAJ_STEPS: 130,
  TRAJ_DT:    0.09,

  /* Per-difficulty tweaks */
  DIFF: {
    easy:   { cScale: 0.25, scatter: 0.04 },
    medium: { cScale: 0.80, scatter: 0.12 },
    hard:   { cScale: 1.30, scatter: 0.24 },
  },

  /* Pegs: [x, z, points, color] */
  PEGS: [
    [-3.5, -1.4, 1, 0xff4444],
    [-3.5,  1.2, 1, 0xff4444],
    [-1.8, -0.1, 2, 0xffcc00],
    [ 0.0, -1.6, 3, 0x33aaff],
    [ 0.0,  0.0, 5, 0xffd700],  // gold centre
    [ 0.0,  1.6, 3, 0x33aaff],
    [ 1.8, -0.1, 2, 0xffcc00],
    [ 3.5, -1.4, 1, 0xff4444],
    [ 3.5,  1.2, 1, 0xff4444],
  ],
};

// ============================================================
// 2. GLOBALS
// ============================================================
let renderer, scene, camera, clock;
let waterMesh, waterUniforms;
let aimRingMesh, aimCircleMesh;
let trajLine, trajPositions;
let bubblePositions, bubbleSpeeds, bubbleSystem;

let pegObjects = [];   // { mesh, pts, x, z, occupied }

let rings       = [];  // active Ring instances
let particles   = [];  // active Particle instances

/* Mouse / charge state */
const mouse     = { x: 0, y: 0, nx: 0, ny: 0 };
let   charging  = false;
let   chargeT   = 0;    // 0–1 charge fraction
let   aimPoint  = null; // THREE.Vector3 on water surface

/* Water current (changes each round) */
let currentVec  = new THREE.Vector3(0, 0, 0);

/* Game state */
const GS = {
  phase:    'start',   // 'start' | 'playing' | 'gameover'
  score:    0,
  ringsLeft: CFG.TOTAL_RINGS,
  timeLeft:  CFG.ROUND_TIME,
  combo:     0,
  highScore: Number(localStorage.getItem('ringHigh') || 0),
  aiAssist:  false,
  difficulty: 'medium',
  timerID:   null,
};

// ============================================================
// 3. WATER SHADERS
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
// 4. SCENE SETUP
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
  scene.fog = new THREE.FogExp2(0x0a2a44, 0.025);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 120);
  camera.position.set(0, 9.5, 9.5);
  camera.lookAt(0, -0.5, 0);

  clock = new THREE.Clock();
  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function createLights() {
  /* Soft ambient – underwater blue */
  scene.add(new THREE.AmbientLight(0x204060, 1.6));

  /* Main sun – slightly warm through glass */
  const sun = new THREE.DirectionalLight(0x99ccff, 2.4);
  sun.position.set(6, 16, 10);
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

function createTank() {
  const { TW, TH, TD } = CFG;
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.10,
    roughness: 0.05,
    metalness: 0.0,
    transmission: 0.85,
    thickness: 0.15,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const edgeMat = new THREE.LineBasicMaterial({ color: 0x55aadd, transparent: true, opacity: 0.5 });

  /* Build 5 glass panels (no top) */
  const panels = [
    /* x, y, z, rotY, w, h */
    [0,          0, -TD / 2, 0,         TW, TH],  // back
    [0,          0,  TD / 2, 0,         TW, TH],  // front
    [-TW / 2,    0,  0,      Math.PI/2, TD, TH],  // left
    [ TW / 2,    0,  0,      Math.PI/2, TD, TH],  // right
    [0, -TH / 2, 0,  Math.PI/2,         TW, TD],  // bottom
  ];
  panels.forEach(([x, y, z, ry, w, h]) => {
    const g = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(g, glassMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    if (y < 0) m.rotation.x = -Math.PI / 2;
    scene.add(m);
  });

  /* Wireframe edges for tank outline */
  const boxGeo = new THREE.BoxGeometry(TW, TH, TD);
  const edges  = new THREE.EdgesGeometry(boxGeo);
  const frame  = new THREE.LineSegments(edges, edgeMat);
  scene.add(frame);
}

function createWaterSurface() {
  const { TW, TD, WATER_Y } = CFG;
  waterUniforms = {
    uTime:     { value: 0 },
  };
  const geo = new THREE.PlaneGeometry(TW - 0.01, TD - 0.01, 40, 30);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader:   waterVert,
    fragmentShader: waterFrag,
    uniforms: waterUniforms,
    transparent: true,
    depthWrite:  false,
    side: THREE.FrontSide,
  });
  waterMesh = new THREE.Mesh(geo, mat);
  waterMesh.position.y = WATER_Y;
  waterMesh.renderOrder = 1;
  scene.add(waterMesh);
}

function createFloor() {
  const { TW, TD, FLOOR_Y } = CFG;
  /* Sand base */
  const sandGeo = new THREE.PlaneGeometry(TW - 0.2, TD - 0.2, 20, 14);
  const sandMat = new THREE.MeshStandardMaterial({
    color: 0x8a7040,
    roughness: 0.95,
    metalness: 0.0,
    emissive: 0x1a1005,
    emissiveIntensity: 0.5,
  });
  const sand = new THREE.Mesh(sandGeo, sandMat);
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = FLOOR_Y + 0.01;
  sand.receiveShadow = true;
  scene.add(sand);

  /* Random small rocks */
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x556055, roughness: 0.9 });
  for (let i = 0; i < 18; i++) {
    const r = 0.05 + Math.random() * 0.14;
    const g = new THREE.SphereGeometry(r, 6, 5);
    const m = new THREE.Mesh(g, rockMat);
    m.position.set(
      (Math.random() - 0.5) * (TW - 1.2),
      FLOOR_Y + r * 0.5,
      (Math.random() - 0.5) * (TD - 1.0)
    );
    m.rotation.set(Math.random(), Math.random(), Math.random());
    m.castShadow = true;
    scene.add(m);
  }

  /* Seaweed decorations */
  const swMat = new THREE.MeshStandardMaterial({ color: 0x1a6a2a, emissive: 0x081a08, emissiveIntensity: 0.4 });
  for (let i = 0; i < 8; i++) {
    for (let seg = 0; seg < 4; seg++) {
      const sw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.035, 0.5 + Math.random() * 0.4, 4),
        swMat
      );
      sw.position.set(
        (Math.random() - 0.5) * (TW - 0.8),
        FLOOR_Y + 0.25 + seg * 0.45,
        (Math.random() - 0.5) * (TD - 0.8)
      );
      sw.rotation.z = (Math.random() - 0.5) * 0.4;
      scene.add(sw);
    }
  }
}

function createPegs() {
  const { PEGS, PEG_R, PEG_H, FLOOR_Y } = CFG;
  const SCORE_LABELS = ['', '①', '②', '③', '④', '⑤'];

  PEGS.forEach(([px, pz, pts, col], i) => {
    /* Base plate */
    const baseMat = new THREE.MeshStandardMaterial({
      color: col, roughness: 0.5, metalness: 0.3,
      emissive: col, emissiveIntensity: 0.15,
    });
    const baseGeo = new THREE.CylinderGeometry(PEG_R * 2.5, PEG_R * 2.5, 0.06, 16);
    const base    = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(px, FLOOR_Y + 0.03, pz);
    base.receiveShadow = true;
    scene.add(base);

    /* Peg shaft */
    const pegMat = new THREE.MeshStandardMaterial({
      color: col,
      roughness: 0.35,
      metalness: 0.6,
      emissive: col,
      emissiveIntensity: 0.25,
    });
    const pegGeo = new THREE.CylinderGeometry(PEG_R, PEG_R * 1.15, PEG_H, 16);
    const peg    = new THREE.Mesh(pegGeo, pegMat);
    peg.position.set(px, FLOOR_Y + PEG_H / 2, pz);
    peg.castShadow  = true;
    peg.receiveShadow = true;
    scene.add(peg);

    /* Tip sphere */
    const tipGeo = new THREE.SphereGeometry(PEG_R * 1.3, 12, 8);
    const tip    = new THREE.Mesh(tipGeo, pegMat);
    tip.position.set(px, FLOOR_Y + PEG_H + PEG_R * 0.9, pz);
    scene.add(tip);

    /* Halo glow ring around base (for visibility) */
    const haloGeo = new THREE.TorusGeometry(PEG_R * 3.5, PEG_R * 0.3, 6, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.35, depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(px, FLOOR_Y + 0.08, pz);
    scene.add(halo);

    /* Point-value sprite (canvas texture) */
    const sprite = makeTextSprite(SCORE_LABELS[pts] || `${pts}`, col);
    sprite.position.set(px, FLOOR_Y + PEG_H + 0.55, pz);
    scene.add(sprite);

    pegObjects.push({ mesh: peg, pts, x: px, z: pz, occupied: false, halo, sprite });
  });
}

function makeTextSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = `#${color.toString(16).padStart(6,'0')}`;
  ctx.font = 'bold 36px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sp  = new THREE.Sprite(mat);
  sp.scale.set(0.55, 0.55, 1);
  return sp;
}

function createBubbleSystem() {
  const count = 180;
  bubblePositions = new Float32Array(count * 3);
  bubbleSpeeds    = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    bubblePositions[i * 3]     = (Math.random() - 0.5) * (CFG.TW - 0.4);
    bubblePositions[i * 3 + 1] = CFG.FLOOR_Y + Math.random() * (CFG.WATER_Y - CFG.FLOOR_Y);
    bubblePositions[i * 3 + 2] = (Math.random() - 0.5) * (CFG.TD - 0.4);
    bubbleSpeeds[i] = 0.3 + Math.random() * 0.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(bubblePositions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaaddff, size: 0.06, transparent: true, opacity: 0.55,
    sizeAttenuation: true, depthWrite: false,
  });
  bubbleSystem = new THREE.Points(geo, mat);
  scene.add(bubbleSystem);
}

function updateBubbles(dt) {
  const count = bubblePositions.length / 3;
  for (let i = 0; i < count; i++) {
    bubblePositions[i * 3 + 1] += bubbleSpeeds[i] * dt;
    if (bubblePositions[i * 3 + 1] > CFG.WATER_Y) {
      bubblePositions[i * 3]     = (Math.random() - 0.5) * (CFG.TW - 0.5);
      bubblePositions[i * 3 + 1] = CFG.FLOOR_Y + Math.random() * 0.3;
      bubblePositions[i * 3 + 2] = (Math.random() - 0.5) * (CFG.TD - 0.5);
    }
  }
  bubbleSystem.geometry.attributes.position.needsUpdate = true;
}

function createAimHelper() {
  /* Ghost ring shown at aim position above water */
  const aimGeo = new THREE.TorusGeometry(CFG.RING_R, CFG.RING_T, 12, 36);
  const aimMat = new THREE.MeshBasicMaterial({
    color: 0x00eeff, transparent: true, opacity: 0.55, depthWrite: false,
  });
  aimRingMesh = new THREE.Mesh(aimGeo, aimMat);
  aimRingMesh.rotation.x = Math.PI / 2;
  aimRingMesh.visible = false;
  scene.add(aimRingMesh);

  /* Circle on water surface */
  const circGeo = new THREE.RingGeometry(CFG.RING_R - 0.04, CFG.RING_R + 0.04, 32);
  const circMat = new THREE.MeshBasicMaterial({
    color: 0x00ffcc, transparent: true, opacity: 0.40,
    side: THREE.DoubleSide, depthWrite: false,
  });
  aimCircleMesh = new THREE.Mesh(circGeo, circMat);
  aimCircleMesh.rotation.x = -Math.PI / 2;
  aimCircleMesh.visible = false;
  scene.add(aimCircleMesh);
}

function createTrajectoryLine() {
  const maxPts = CFG.TRAJ_STEPS + 1;
  trajPositions = new Float32Array(maxPts * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(trajPositions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.LineBasicMaterial({
    color: 0x00ffcc, transparent: true, opacity: 0.7,
    linewidth: 2, depthWrite: false,
  });
  trajLine = new THREE.Line(geo, mat);
  trajLine.renderOrder = 2;
  trajLine.visible = false;
  scene.add(trajLine);
}

// ============================================================
// 5. RING CLASS
// ============================================================
class Ring {
  constructor(x, y, z, vx, vy, vz) {
    this.pos  = new THREE.Vector3(x, y, z);
    this.vel  = new THREE.Vector3(vx, vy, vz);
    this.rx   = (Math.random() - 0.5) * 2;  // spin axis x
    this.rz   = (Math.random() - 0.5) * 2;  // spin axis z
    this.spin = 0.8 + Math.random() * 1.5;  // spin speed in air
    this.spinAxis = new THREE.Vector3(this.rx, 0, this.rz).normalize();

    this.inWater  = false;
    this.splashed = false;
    this.caught   = false;
    this.pegIdx   = -1;
    this.alive    = true;
    this.age      = 0;
    this.settleT  = 0;

    /* Mesh */
    const geo = new THREE.TorusGeometry(CFG.RING_R, CFG.RING_T, 14, 42);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdaa520, metalness: 0.85, roughness: 0.18,
      emissive: 0x2a1a00, emissiveIntensity: 0.15,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    scene.add(this.mesh);
    this._syncMesh();
  }

  update(dt) {
    if (!this.alive) return;
    this.age += dt;

    if (this.caught) {
      this.settleT += dt;
      /* gentle wobble on landing */
      if (this.settleT < 0.6) {
        const w = Math.sin(this.settleT * 18) * 0.08 * (1 - this.settleT / 0.6);
        this.mesh.rotation.x = Math.PI / 2 + w;
      } else {
        this.mesh.rotation.x = Math.PI / 2;
      }
      return;
    }

    const underwater = this.pos.y < CFG.WATER_Y;

    /* Water entry */
    if (underwater && !this.splashed) {
      this.splashed = true;
      this.inWater  = true;
      this.vel.multiplyScalar(CFG.ENTRY_DAMP);
      spawnSplash(this.pos.x, CFG.WATER_Y, this.pos.z);
      if (GS.aiAssist) updateTrajectoryLine(); // refresh after entry
    }

    /* Gravity */
    this.vel.y += CFG.GRAVITY * dt;

    /* Buoyancy + drag when submerged */
    if (underwater) {
      this.vel.y += CFG.BUOYANCY * dt;
      const spd = this.vel.length();
      if (spd > 0.001) {
        const drag = Math.min(CFG.WATER_DRAG * spd * dt, spd);
        this.vel.addScaledVector(this.vel, -drag / spd);
      }
      /* Water current */
      this.vel.x += currentVec.x * dt;
      this.vel.z += currentVec.z * dt;
    }

    this.pos.addScaledVector(this.vel, dt);

    /* Floor */
    const floorY = CFG.FLOOR_Y + CFG.RING_T;
    if (this.pos.y < floorY) {
      this.pos.y = floorY;
      this.vel.y *= -0.2;
      this.vel.x *= 0.6;
      this.vel.z *= 0.6;
      if (Math.abs(this.vel.y) < 0.1) this.vel.y = 0;
    }

    /* Tank walls */
    const hw = CFG.TW / 2 - CFG.RING_T, hd = CFG.TD / 2 - CFG.RING_T;
    if (Math.abs(this.pos.x) > hw) {
      this.pos.x = Math.sign(this.pos.x) * hw;
      this.vel.x *= -CFG.BOUNCE_DAMP;
    }
    if (Math.abs(this.pos.z) > hd) {
      this.pos.z = Math.sign(this.pos.z) * hd;
      this.vel.z *= -CFG.BOUNCE_DAMP;
    }

    /* Spinning in air; dampen in water */
    const spinFactor = underwater ? 0.04 : 1.0;
    const spinAngle  = this.spin * spinFactor * dt;
    this.mesh.rotateOnWorldAxis(this.spinAxis, spinAngle);

    /* Peg collision (check whenever submerged and near peg level) */
    if (underwater) {
      this._checkPegs();
    }

    this._syncMesh();
  }

  _checkPegs() {
    const pegTop = CFG.FLOOR_Y + CFG.PEG_H + CFG.PEG_R;
    /* Only check when ring is near peg level */
    if (this.pos.y > pegTop + 0.55) return;

    for (let i = 0; i < pegObjects.length; i++) {
      const p = pegObjects[i];
      if (p.occupied) continue;

      const dx   = this.pos.x - p.x;
      const dz   = this.pos.z - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      /* Peg inside ring hole: dist < inner hole radius with generous tolerance */
      if (dist < CFG.RING_R * 0.88 && this.pos.y <= pegTop + 0.40) {
        this._landOnPeg(i);
        return;
      }
    }
  }

  _landOnPeg(i) {
    const p = pegObjects[i];
    this.caught  = true;
    this.pegIdx  = i;
    this.vel.set(0, 0, 0);
    this.pos.set(p.x, CFG.FLOOR_Y + CFG.PEG_H + CFG.RING_T * 0.5, p.z);
    p.occupied = true;

    /* Restore flat orientation */
    this.mesh.rotation.set(Math.PI / 2, 0, 0);

    onRingCaught(p.pts, i);
  }

  _syncMesh() {
    this.mesh.position.copy(this.pos);
    /* Keep flat for caught ring; managed by update otherwise */
  }

  dispose() {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.alive = false;
  }
}

// ============================================================
// 6. PARTICLES (splash drops)
// ============================================================
class Particle {
  constructor(x, y, z) {
    this.pos  = new THREE.Vector3(x, y, z);
    this.vel  = new THREE.Vector3(
      (Math.random() - 0.5) * 2.8,
      1.5 + Math.random() * 3.0,
      (Math.random() - 0.5) * 2.8
    );
    this.life  = 1.0;
    this.decay = 1.0 + Math.random() * 0.8;

    const r   = 0.04 + Math.random() * 0.07;
    const geo = new THREE.SphereGeometry(r, 4, 3);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x88ccee, transparent: true, opacity: 0.8, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
  }

  update(dt) {
    this.vel.y  -= 8 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.life   -= this.decay * dt;
    this.mesh.position.copy(this.pos);
    this.mesh.material.opacity = Math.max(0, this.life * 0.75);
    return this.life > 0 && this.pos.y > CFG.FLOOR_Y;
  }

  dispose() {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function spawnSplash(x, y, z) {
  const count = 10 + Math.floor(Math.random() * 8);
  for (let i = 0; i < count; i++) {
    particles.push(new Particle(x, y, z));
  }
}

// ============================================================
// 7. INPUT HANDLING
// ============================================================
function setupInput() {
  const canvas = renderer.domElement;

  canvas.addEventListener('mousemove', onMouseMove, false);
  canvas.addEventListener('mousedown', onMouseDown, false);
  canvas.addEventListener('mouseup',   onMouseUp,   false);
  canvas.addEventListener('mouseleave', () => {
    aimRingMesh.visible   = false;
    aimCircleMesh.visible = false;
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

  if (GS.phase !== 'playing') return;

  aimPoint = getAimPoint();
  if (!aimPoint) {
    aimRingMesh.visible   = false;
    aimCircleMesh.visible = false;
    return;
  }

  aimRingMesh.position.set(aimPoint.x, CFG.WATER_Y + 0.55, aimPoint.z);
  aimRingMesh.visible   = true;
  aimCircleMesh.position.set(aimPoint.x, CFG.WATER_Y + 0.02, aimPoint.z);
  aimCircleMesh.visible = true;

  if (GS.aiAssist) updateTrajectoryLine();
}

function onMouseDown() {
  if (GS.phase !== 'playing') return;
  if (!aimPoint)              return;
  if (GS.ringsLeft <= 0)      return;
  charging = true;
  chargeT  = 0;
}

function onMouseUp() {
  if (!charging) return;
  charging = false;
  if (GS.phase !== 'playing' || !aimPoint || GS.ringsLeft <= 0) return;

  const power = CFG.MIN_POWER + (CFG.MAX_POWER - CFG.MIN_POWER) * chargeT;
  doThrow(aimPoint.x, aimPoint.z, power);
}

function doThrow(ax, az, power) {
  const diff  = CFG.DIFF[GS.difficulty];
  const sc    = diff.scatter;
  const sx    = (Math.random() - 0.5) * sc * 2;
  const sz    = (Math.random() - 0.5) * sc * 2;

  const r = new Ring(
    ax + sx, CFG.WATER_Y + 0.55, az + sz,
    sx * 0.5,  // slight horizontal from scatter
    -power,    // downward
    sz * 0.5
  );
  rings.push(r);
  GS.ringsLeft--;
  updateHUD();

  /* Hide trajectory during flight */
  if (trajLine) trajLine.visible = false;
}

// ============================================================
// 8. AI SYSTEM
// ============================================================

/**
 * Simulate a ring drop from (ax, ay, az) with velocity (0, -power, 0)
 * plus the current water current.  Returns array of {x, y, z} positions.
 */
function simulateTrajectory(ax, az, power) {
  const pts = [];
  let px = ax, py = CFG.WATER_Y + 0.55, pz = az;
  let vx = 0, vy = -power, vz = 0;
  const dt = CFG.TRAJ_DT;

  for (let i = 0; i <= CFG.TRAJ_STEPS; i++) {
    pts.push({ x: px, y: py, z: pz });

    const uw = py < CFG.WATER_Y;

    vy += CFG.GRAVITY * dt;
    if (uw) {
      vy += CFG.BUOYANCY * dt;
      const spd  = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const drag = Math.min(CFG.WATER_DRAG * spd * dt, spd) * 0.9;
      if (spd > 0.001) {
        vx -= (vx / spd) * drag;
        vy -= (vy / spd) * drag;
        vz -= (vz / spd) * drag;
      }
      vx += currentVec.x * dt;
      vz += currentVec.z * dt;
    }

    px += vx * dt;
    py += vy * dt;
    pz += vz * dt;

    if (py <= CFG.FLOOR_Y + CFG.RING_T) break;
  }
  return pts;
}

function updateTrajectoryLine() {
  if (!aimPoint || !GS.aiAssist) { trajLine.visible = false; return; }

  const power = CFG.MIN_POWER + (CFG.MAX_POWER - CFG.MIN_POWER) * chargeT;
  const pts   = simulateTrajectory(aimPoint.x, aimPoint.z, power);

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

function aiAutoThrow() {
  if (GS.phase !== 'playing' || GS.ringsLeft <= 0) return;

  /* Pick an unoccupied peg (prefer higher value) */
  const candidates = pegObjects
    .map((p, i) => ({ ...p, i }))
    .filter(p => !p.occupied)
    .sort((a, b) => b.pts - a.pts);

  if (candidates.length === 0) return;
  const target = candidates[0];

  /* Medium power for controlled descent */
  const power = CFG.MIN_POWER + (CFG.MAX_POWER - CFG.MIN_POWER) * 0.55;

  /* AI compensates for water current:
     simulate from directly above peg, measure drift, then aim opposite */
  let ax = target.x, az = target.z;
  for (let iter = 0; iter < 3; iter++) {
    const pts = simulateTrajectory(ax, az, power);
    if (pts.length === 0) break;
    const last = pts[pts.length - 1];
    ax -= (last.x - target.x) * 0.7;
    az -= (last.z - target.z) * 0.7;
  }

  /* Apply scatter based on difficulty */
  const diff = CFG.DIFF[GS.difficulty];
  const sc   = diff.scatter * 1.5;
  ax += (Math.random() - 0.5) * sc * 2;
  az += (Math.random() - 0.5) * sc * 2;

  /* Clamp to tank */
  ax = Math.max(-CFG.TW / 2 + CFG.RING_R, Math.min(CFG.TW / 2 - CFG.RING_R, ax));
  az = Math.max(-CFG.TD / 2 + CFG.RING_R, Math.min(CFG.TD / 2 - CFG.RING_R, az));

  /* Show aim briefly then throw */
  aimPoint = new THREE.Vector3(ax, CFG.WATER_Y, az);
  aimRingMesh.position.set(ax, CFG.WATER_Y + 0.55, az);
  aimRingMesh.visible   = true;
  aimCircleMesh.position.set(ax, CFG.WATER_Y + 0.02, az);
  aimCircleMesh.visible = true;

  if (GS.aiAssist) updateTrajectoryLine();

  setTimeout(() => doThrow(ax, az, power), 450);
}

// ============================================================
// 9. GAME LOGIC
// ============================================================

function onRingCaught(pts, pegIdx) {
  GS.combo++;
  const mult = Math.min(GS.combo, 5);
  const gain = pts * mult;
  GS.score  += gain;

  /* Floating score popup */
  const p  = pegObjects[pegIdx];
  const sv = new THREE.Vector3(p.x, CFG.FLOOR_Y + CFG.PEG_H + 1.0, p.z);
  const sc = sv.project(camera);
  const sx = (sc.x * 0.5 + 0.5) * innerWidth;
  const sy = (1 - (sc.y * 0.5 + 0.5)) * innerHeight;
  showFloatingScore(`+${gain}`, sx, sy, p.pts);

  /* Peg flash */
  flashPeg(pegIdx);

  /* Screen flash */
  document.getElementById('hit-flash').classList.remove('flash');
  void document.getElementById('hit-flash').offsetWidth;
  document.getElementById('hit-flash').classList.add('flash');

  /* Combo popup */
  if (GS.combo >= 2) {
    const el = document.getElementById('combo-popup');
    el.textContent = `${mult}× COMBO!`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  updateHUD();
}

function flashPeg(idx) {
  const p = pegObjects[idx];
  const origIntensity = 0.25;
  p.mesh.material.emissiveIntensity = 1.4;
  p.halo.material.opacity = 0.9;
  setTimeout(() => {
    p.mesh.material.emissiveIntensity = origIntensity;
    p.halo.material.opacity = 0.35;
  }, 400);
}

function showFloatingScore(text, sx, sy, pts) {
  const el = document.createElement('div');
  el.className = 'score-float';
  el.textContent = text;
  el.style.left = sx + 'px';
  el.style.top  = sy + 'px';
  /* colour by peg value */
  const cols = { 1: '#ff7777', 2: '#ffdd44', 3: '#55aaff', 5: '#ffd700' };
  el.style.color = cols[pts] || '#fff';
  document.getElementById('ui').appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function startGame() {
  /* Sync difficulty from start screen select (if coming from start screen) */
  const startDiff = document.getElementById('diff-select-start');
  if (startDiff) {
    GS.difficulty = startDiff.value;
    document.getElementById('diff-select').value = GS.difficulty;
  }

  /* Reset state */
  GS.phase     = 'playing';
  GS.score     = 0;
  GS.ringsLeft = CFG.TOTAL_RINGS;
  GS.timeLeft  = CFG.ROUND_TIME;
  GS.combo     = 0;

  /* Reset pegs */
  pegObjects.forEach(p => { p.occupied = false; });

  /* Clear old rings */
  rings.forEach(r => r.dispose());
  rings = [];

  /* Clear particles */
  particles.forEach(p => p.dispose());
  particles = [];

  /* Random water current for this round */
  const diff  = CFG.DIFF[GS.difficulty];
  const angle = Math.random() * Math.PI * 2;
  const mag   = diff.cScale * (0.5 + Math.random() * 0.5);
  currentVec.set(Math.cos(angle) * mag, 0, Math.sin(angle) * mag);

  /* Show current direction hint */
  updateCurrentIndicator();

  /* Screens */
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('gameover-screen').classList.add('hidden');

  updateHUD();

  /* Timer */
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

  aimRingMesh.visible   = false;
  aimCircleMesh.visible = false;
  trajLine.visible      = false;
  charging = false;

  if (GS.score > GS.highScore) {
    GS.highScore = GS.score;
    localStorage.setItem('ringHigh', GS.highScore);
  }

  document.getElementById('final-score').textContent  = GS.score;
  document.getElementById('hi-score-go').textContent  = GS.highScore;

  const hits = CFG.TOTAL_RINGS - GS.ringsLeft;
  document.getElementById('go-rings-thrown').textContent = GS.ringsLeft === 0 ? CFG.TOTAL_RINGS : CFG.TOTAL_RINGS - GS.ringsLeft;
  document.getElementById('go-rings-hit').textContent    = pegObjects.filter(p => p.occupied).length;

  document.getElementById('gameover-screen').classList.remove('hidden');
}

function updateHUD() {
  document.getElementById('hud-score-val').textContent  = GS.score;
  document.getElementById('hud-timer-val').textContent  = GS.timeLeft;
  document.getElementById('hud-rings-val').textContent  = GS.ringsLeft;
  document.getElementById('hud-hi-val').textContent     = GS.highScore;

  /* Check auto round-end */
  if (GS.phase === 'playing' && GS.ringsLeft <= 0) {
    /* Wait a moment for last ring to settle */
    setTimeout(() => {
      if (GS.ringsLeft <= 0 && GS.phase === 'playing') endGame();
    }, 3000);
  }
}

function updateCurrentIndicator() {
  const el = document.getElementById('current-arrow');
  if (!el) return;
  const angle = Math.atan2(currentVec.z, currentVec.x) * 180 / Math.PI;
  el.style.transform = `rotate(${angle}deg)`;
  const mag   = currentVec.length();
  el.style.opacity = 0.4 + mag * 0.4;
}

// Aim raycasting helper
function getAimPoint() {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera({ x: mouse.nx, y: mouse.ny }, camera);
  const plane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CFG.WATER_Y);
  const target = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, target);
  if (!target) return null;
  /* Clamp to tank */
  target.x = Math.max(-CFG.TW / 2 + CFG.RING_R, Math.min(CFG.TW / 2 - CFG.RING_R, target.x));
  target.z = Math.max(-CFG.TD / 2 + CFG.RING_R, Math.min(CFG.TD / 2 - CFG.RING_R, target.z));
  return target;
}

// ============================================================
// 10. ANIMATION LOOP
// ============================================================
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  /* Water */
  if (waterUniforms) waterUniforms.uTime.value += dt;

  /* Bubbles */
  updateBubbles(dt);

  /* Charge bar */
  if (charging && GS.phase === 'playing') {
    chargeT = Math.min(chargeT + dt / CFG.CHARGE_DUR, 1.0);
    document.getElementById('power-bar-inner').style.width = (chargeT * 100) + '%';
    document.getElementById('power-bar-wrap').classList.add('active');
    if (GS.aiAssist) updateTrajectoryLine();
  } else {
    document.getElementById('power-bar-wrap').classList.remove('active');
  }

  /* Aim ring pulsing */
  if (aimRingMesh.visible) {
    const t = waterUniforms ? waterUniforms.uTime.value : 0;
    aimRingMesh.material.opacity    = 0.45 + Math.sin(t * 3) * 0.15;
    aimCircleMesh.material.opacity  = 0.30 + Math.sin(t * 3 + 1) * 0.10;
  }

  /* Update rings */
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].update(dt);
    /* Combo reset if ring hits floor without catching */
    if (!rings[i].caught && rings[i].age > 0.5 &&
        rings[i].pos.y <= CFG.FLOOR_Y + CFG.RING_T + 0.05 &&
        Math.abs(rings[i].vel.y) < 0.2 &&
        rings[i].vel.length() < 0.3) {
      if (GS.combo > 0) { GS.combo = 0; updateHUD(); }
    }
  }

  /* Update particles */
  for (let i = particles.length - 1; i >= 0; i--) {
    if (!particles[i].update(dt)) {
      particles[i].dispose();
      particles.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

// ============================================================
// 11. UI WIRING
// ============================================================
function wireUI() {
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);

  const aiAssistBtn = document.getElementById('btn-ai-assist');
  aiAssistBtn.addEventListener('click', () => {
    GS.aiAssist = !GS.aiAssist;
    aiAssistBtn.classList.toggle('active', GS.aiAssist);
    if (!GS.aiAssist) trajLine.visible = false;
  });

  document.getElementById('btn-ai-throw').addEventListener('click', aiAutoThrow);

  document.getElementById('diff-select').addEventListener('change', e => {
    GS.difficulty = e.target.value;
  });
}

// ============================================================
// 12. BOOTSTRAP
// ============================================================
function init() {
  initThree();
  createLights();
  createTank();
  createWaterSurface();
  createFloor();
  createPegs();
  createBubbleSystem();
  createAimHelper();
  createTrajectoryLine();
  setupInput();
  wireUI();
  animate();
}

window.addEventListener('DOMContentLoaded', init);

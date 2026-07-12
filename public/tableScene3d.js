import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/addons/loaders/GLTFLoader.js';

const SUITS = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const RED_SUITS = new Set(['H', 'D']);
const CARD_SIZE = { width: 0.42, height: 0.62 };
const CARD_THICKNESS = 0.012;
const TABLE_CARD_SPACING = 0.36;
const VIEWED_CARD_SPACING = 0.18;
const TABLE_RADIUS = 3.05;
const LABEL_RADIUS = 4.15;
const DECK_SCALE = 1.08;
const TABLETOP_PROP_Y = 0.3;
const TABLE_TIMER_SIZE = { width: CARD_SIZE.height * DECK_SCALE, height: CARD_SIZE.width * DECK_SCALE };
const TABLE_TIMER_POSITION = new THREE.Vector3(-0.58, TABLETOP_PROP_Y, -0.22);
const DEFAULT_CAMERA_PITCH = 0.62;
const DEFAULT_CAMERA_DISTANCE = 8.9;
const DEFAULT_CAMERA_TARGET_Y = 0.04;
const ZHA_CAMERA_TRANSITION_MS = 1250;
const ZHA_ROOM_SEATS = 8;
const ZHA_ROOM_FLOOR_Y = -0.28;
const ZHA_PROCEDURAL_CHAIR_FLOOR_OFFSET = 0.18;
const ZHA_CHAIR_TARGET_HEIGHT = 1.72;
const PUBLIC_BASE_PATH = String(window.SFG_CONFIG?.publicBasePath || '').replace(/\/+$/g, '');
const DEFAULT_CHAIR_ASSET_URL = `${PUBLIC_BASE_PATH}/assets/models/armchair-01-game.glb`;
const DEFAULT_CARD_ASSET_BASE_URL = `${PUBLIC_BASE_PATH}/assets/cards/ornate-v1`;
const PLAYER_CHIP_LIMIT = 50;
const POT_CHIP_LIMIT = 50;
const CHIP_HEIGHT = 0.026;
const CHIP_RADIUS = 0.092;
const CHIP_GEOMETRY = new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 36);
const CHIP_PALETTES = [
  { face: 0xf5d77d, edge: 0x76551a, ink: '#3a2711' },
  { face: 0x2fbf9c, edge: 0x0b5546, ink: '#062b25' },
  { face: 0xd55362, edge: 0x6a2530, ink: '#fff0f0' },
  { face: 0x4f75d8, edge: 0x23346c, ink: '#eef4ff' },
  { face: 0xf3f0e6, edge: 0x8a8272, ink: '#24221d' },
  { face: 0x242832, edge: 0x0e1118, ink: '#f7e7b0' },
];
const TABLE_THEME_KEYS = new Set(['classic', 'red_wood_tray', 'zha_room']);
const TABLE_ASSET_KEYS = new Set(['procedural_zha_round', 'clean_board_game_store_table']);

function createTableScene3D(container, options = {}) {
  return new TableScene3D(container, options);
}

class TableScene3D {
  constructor(container, options = {}) {
    this.container = container;
    this.tableTheme = normalizeTableTheme(options.tableTheme || window.SFG_CONFIG?.visual?.tableTheme);
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.playersGroup = new THREE.Group();
    this.cardsGroup = new THREE.Group();
    this.potGroup = new THREE.Group();
    this.turnTimerGroup = new THREE.Group();
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'table-scene-label-layer';
    this.labelsById = new Map();
    this.cardMeshes = [];
    this.sceneMaterials = new Set();
    this.materialsByDenomination = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.yaw = -0.42;
    this.pitch = DEFAULT_CAMERA_PITCH;
    this.distance = DEFAULT_CAMERA_DISTANCE;
    this.lookYawOffset = 0;
    this.lookPitchOffset = 0;
    this.cameraMode = this.tableTheme === 'zha_room' ? 'overview' : 'orbit';
    this.cameraTransition = null;
    this.cameraDesiredPose = null;
    this.cameraRoomKey = '';
    this.cameraSeatKey = '';
    this.lastHandId = '';
    this.lastSettlementAt = 0;
    this.potCollectAnimation = null;
    this.dealStartedAt = 0;
    this.turnTimerText = '';
    this.turnTimerWarning = false;
    this.lastSnapshot = null;
    this.disposed = false;
    this.drag = null;
    this.textureLoader = new THREE.TextureLoader();
    this.gltfLoader = new GLTFLoader();
    this.avatarTextures = new Map();
    this.cardTextureCache = new Map();
    this.zhaRoomChairSlots = [];
    this.chairAssetRoot = null;
    this.chairAssetStatus = 'idle';
    this.chairAssetMetrics = null;
    this.chairAssetUrl = String(
      options.chairAssetUrl || window.SFG_CONFIG?.visual?.chairAssetUrl || DEFAULT_CHAIR_ASSET_URL
    );
    this.cardAssetBaseUrl = normalizeAssetBaseUrl(
      options.cardAssetBaseUrl || window.SFG_CONFIG?.visual?.cardAssetBaseUrl || DEFAULT_CARD_ASSET_BASE_URL
    );
    this.tableAsset = normalizeTableAsset(options.tableAsset || window.SFG_CONFIG?.visual?.tableAsset);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.tableTheme === 'zha_room' ? 1.24 : 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'table-scene-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    this.rayTarget = new THREE.Vector3(0, DEFAULT_CAMERA_TARGET_Y, 0);

    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);
    container.appendChild(this.labelLayer);

    this.installScene();
    if (this.tableTheme === 'zha_room') {
      const pose = this.getZhaCameraPose('overview', [], '');
      this.cameraDesiredPose = pose;
      this.applyCameraPose(pose);
    }
    const thisScene = this;
    window.__SFG_TABLE_SCENE_DIAGNOSTICS__ = {
      renderer: this.renderer.info,
      get theme() {
        return thisScene.tableTheme;
      },
      get cameraMode() {
        return thisScene.cameraMode;
      },
      get tableAsset() {
        return thisScene.tableAsset;
      },
      get chairAssetStatus() {
        return thisScene.chairAssetStatus;
      },
      get chairAssetMetrics() {
        return thisScene.chairAssetMetrics;
      },
      get cardTextureCount() {
        return thisScene.cardTextureCache.size;
      },
      get roomStatus() {
        return thisScene.lastSnapshot?.room?.status || 'none';
      },
    };
    this.bindEvents();
    this.resize();
    this.renderFrame = this.renderFrame.bind(this);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    requestAnimationFrame(this.renderFrame);
  }

  trackSceneMaterial(material) {
    if (Array.isArray(material)) {
      material.forEach((item) => this.trackSceneMaterial(item));
      return material;
    }
    if (material) this.sceneMaterials.add(material);
    return material;
  }

  installScene() {
    if (this.tableTheme === 'zha_room') this.installZhaRoomScene();
    else if (this.tableTheme === 'red_wood_tray') this.installRedWoodTrayScene();
    else this.installClassicScene();

    this.deck = this.createCardMesh(null, true);
    this.deck.position.set(0, TABLETOP_PROP_Y, -0.18);
    this.deck.rotation.x = -Math.PI / 2;
    this.deck.rotation.z = -0.12;
    this.deck.scale.set(DECK_SCALE, DECK_SCALE, DECK_SCALE);
    this.scene.add(this.deck);
    this.installTurnTimerDevice();

    this.scene.add(this.playersGroup);
    this.scene.add(this.cardsGroup);
    this.scene.add(this.potGroup);
    this.scene.add(this.turnTimerGroup);
  }

  installClassicScene() {
    const ambient = new THREE.HemisphereLight(0xfff2cb, 0x06251f, 1.55);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffefc1, 2.2);
    keyLight.position.set(-3.8, 7.2, 4.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x64ffe0, 1.25);
    rimLight.position.set(4, 4, -5);
    this.scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 14),
      new THREE.MeshStandardMaterial({
        color: 0x2a241f,
        roughness: 0.72,
        metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.24;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 6),
      new THREE.MeshStandardMaterial({
        color: 0x16241f,
        roughness: 0.88,
        metalness: 0.02,
      })
    );
    backWall.position.set(0, 2.65, -6.6);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const sideWall = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 6),
      new THREE.MeshStandardMaterial({
        color: 0x111d1a,
        roughness: 0.9,
        metalness: 0.02,
      })
    );
    sideWall.position.set(-8.4, 2.65, 0);
    sideWall.rotation.y = Math.PI / 2;
    sideWall.receiveShadow = true;
    this.scene.add(sideWall);

    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(5.2, 128),
      new THREE.MeshStandardMaterial({
        color: 0x0d332c,
        roughness: 0.94,
        metalness: 0.01,
      })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.scale.set(1.35, 0.78, 1);
    rug.position.y = -0.22;
    rug.receiveShadow = true;
    this.scene.add(rug);

    const tableBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.96, 3.02, 0.22, 128),
      new THREE.MeshStandardMaterial({
        color: 0x5a321f,
        roughness: 0.64,
        metalness: 0.1,
      })
    );
    tableBase.scale.set(1.36, 1, 0.82);
    tableBase.position.y = 0.03;
    tableBase.castShadow = true;
    tableBase.receiveShadow = true;
    this.scene.add(tableBase);

    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(2.76, 2.76, 0.035, 128),
      new THREE.MeshStandardMaterial({
        color: 0x176846,
        roughness: 0.94,
        metalness: 0.02,
      })
    );
    felt.scale.set(1.33, 1, 0.79);
    felt.position.y = 0.16;
    felt.receiveShadow = true;
    this.scene.add(felt);

    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(2.91, 0.09, 18, 128),
      new THREE.MeshStandardMaterial({
        color: 0x7a442b,
        roughness: 0.5,
        metalness: 0.14,
      })
    );
    rail.scale.set(1.36, 0.82, 0.82);
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.2;
    rail.castShadow = true;
    this.scene.add(rail);
  }

  installRedWoodTrayScene() {
    const ambient = new THREE.HemisphereLight(0xfff2cb, 0x1a2417, 1.48);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffefc1, 2.45);
    keyLight.position.set(-4.8, 7.4, 3.8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xb8ff9d, 0.86);
    rimLight.position.set(4, 4, -5);
    this.scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 14),
      new THREE.MeshStandardMaterial({
        color: 0x26301d,
        roughness: 0.92,
        metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.24;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 6),
      new THREE.MeshStandardMaterial({
        map: createForestBackdropTexture(),
        roughness: 0.96,
        metalness: 0.02,
      })
    );
    backWall.position.set(0, 2.65, -6.6);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const sideWall = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 6),
      new THREE.MeshStandardMaterial({
        color: 0x151d13,
        roughness: 0.9,
        metalness: 0.02,
      })
    );
    sideWall.position.set(-8.4, 2.65, 0);
    sideWall.rotation.y = Math.PI / 2;
    sideWall.receiveShadow = true;
    this.scene.add(sideWall);

    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(9.2, 5.8),
      new THREE.MeshStandardMaterial({
        color: 0x2a2118,
        roughness: 0.94,
        metalness: 0.01,
      })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = -0.22;
    rug.receiveShadow = true;
    this.scene.add(rug);

    const woodMaterial = new THREE.MeshStandardMaterial({
      map: createWoodTexture(),
      roughness: 0.48,
      metalness: 0.12,
    });
    const darkWoodMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c160d,
      roughness: 0.62,
      metalness: 0.08,
    });
    const feltMaterial = new THREE.MeshStandardMaterial({
      map: createRedFeltTexture(),
      roughness: 0.98,
      metalness: 0.01,
    });

    const tableGroup = new THREE.Group();
    const tableBase = new THREE.Mesh(new THREE.BoxGeometry(8.65, 0.36, 5.35), darkWoodMaterial);
    tableBase.position.y = -0.02;
    tableBase.castShadow = true;
    tableBase.receiveShadow = true;
    tableGroup.add(tableBase);

    const felt = new THREE.Mesh(new THREE.BoxGeometry(7.28, 0.055, 4.14), feltMaterial);
    felt.position.y = 0.22;
    felt.receiveShadow = true;
    tableGroup.add(felt);

    [
      { size: [8.7, 0.48, 0.5], position: [0, 0.36, -2.42] },
      { size: [8.7, 0.48, 0.5], position: [0, 0.36, 2.42] },
      { size: [0.5, 0.48, 5.34], position: [-4.1, 0.36, 0] },
      { size: [0.5, 0.48, 5.34], position: [4.1, 0.36, 0] },
    ].forEach((part) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(...part.size), woodMaterial);
      rail.position.set(...part.position);
      rail.castShadow = true;
      rail.receiveShadow = true;
      tableGroup.add(rail);
    });

    [
      { size: [7.55, 0.08, 0.06], position: [0, 0.62, -2.08] },
      { size: [7.55, 0.08, 0.06], position: [0, 0.62, 2.08] },
      { size: [0.06, 0.08, 4.28], position: [-3.73, 0.62, 0] },
      { size: [0.06, 0.08, 4.28], position: [3.73, 0.62, 0] },
    ].forEach((part) => {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(...part.size), darkWoodMaterial);
      groove.position.set(...part.position);
      tableGroup.add(groove);
    });

    this.scene.add(tableGroup);
  }

  installZhaRoomScene() {
    this.scene.background = new THREE.Color(0x120907);
    this.scene.fog = new THREE.Fog(0x120907, 10, 24);

    const ambient = new THREE.HemisphereLight(0xffe7bd, 0x160907, 1.78);
    this.scene.add(ambient);

    const keyLight = new THREE.SpotLight(0xffd7a0, 5.55, 18, Math.PI / 4.8, 0.44, 1.1);
    keyLight.position.set(-2.2, 6.6, 2.4);
    keyLight.target.position.set(0, 0.15, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(keyLight);
    this.scene.add(keyLight.target);

    const fillLight = new THREE.DirectionalLight(0xffdfb4, 1.35);
    fillLight.position.set(3.6, 3.8, 4.4);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffbf83, 0.72);
    rimLight.position.set(-4.8, 2.8, -3.8);
    this.scene.add(rimLight);

    [
      { position: [-5.6, 2.25, -4.6], color: 0xf0a24d, intensity: 2.05 },
      { position: [5.4, 2.0, -4.8], color: 0xffcc88, intensity: 1.82 },
      { position: [4.8, 1.5, 3.7], color: 0xff8755, intensity: 1.22 },
      { position: [0, 2.1, 4.8], color: 0xffd2a0, intensity: 1.18 },
    ].forEach((light) => {
      const lamp = new THREE.PointLight(light.color, light.intensity, 7.6, 1.65);
      lamp.position.set(...light.position);
      this.scene.add(lamp);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 18, 12),
        new THREE.MeshBasicMaterial({ color: light.color, transparent: true, opacity: 0.62 })
      );
      glow.position.copy(lamp.position);
      this.scene.add(glow);
    });

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 14),
      new THREE.MeshStandardMaterial({
        map: createDarkWoodFloorTexture(),
        roughness: 0.7,
        metalness: 0.08,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = ZHA_ROOM_FLOOR_Y;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMaterial = this.trackSceneMaterial(new THREE.MeshStandardMaterial({
      map: createLibraryWallTexture(),
      roughness: 0.88,
      metalness: 0.04,
    }));

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 6.4), wallMaterial);
    backWall.position.set(0, 2.72, -6.7);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6.4), wallMaterial);
    leftWall.position.set(-8.6, 2.72, 0);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(14, 6.4), wallMaterial);
    rightWall.position.set(8.6, 2.72, 0);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.receiveShadow = true;
    this.scene.add(rightWall);

    this.addLibraryShelves();

    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(5.85, 128),
      this.trackSceneMaterial(new THREE.MeshStandardMaterial({
        color: 0x25130f,
        roughness: 0.96,
        metalness: 0.02,
      }))
    );
    rug.rotation.x = -Math.PI / 2;
    rug.scale.set(1.08, 0.82, 1);
    rug.position.y = -0.255;
    rug.receiveShadow = true;
    this.scene.add(rug);

    const woodMaterial = this.trackSceneMaterial(createWarmOakMaterial({
      repeat: [2.45, 0.82],
      bumpScale: 0.018,
    }));
    const darkWoodMaterial = this.trackSceneMaterial(createDarkWoodMaterial({
      repeat: [1.4, 0.72],
      bumpScale: 0.01,
    }));
    const feltMaterial = this.trackSceneMaterial(new THREE.MeshStandardMaterial({
      map: createRedFeltTexture(),
      roughness: 0.96,
      metalness: 0.02,
    }));

    const tableGroup = new THREE.Group();
    tableGroup.name = 'Zha_Table_Group';
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.18, 3.32, 0.34, 160), darkWoodMaterial);
    base.name = 'Zha_Table_Base';
    base.position.y = 0.02;
    base.castShadow = true;
    base.receiveShadow = true;
    tableGroup.add(base);

    const top = new THREE.Mesh(new THREE.CylinderGeometry(3.08, 3.12, 0.12, 160), woodMaterial);
    top.name = 'Zha_Table_Top';
    top.position.y = 0.22;
    top.castShadow = true;
    top.receiveShadow = true;
    tableGroup.add(top);

    const felt = new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.72, 0.035, 160), feltMaterial);
    felt.name = 'Zha_Table_Felt';
    felt.position.y = 0.305;
    felt.receiveShadow = true;
    tableGroup.add(felt);

    const rail = new THREE.Mesh(
      new THREE.TorusGeometry(2.98, 0.15, 22, 160),
      woodMaterial
    );
    rail.name = 'Zha_Table_Rail';
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.34;
    rail.castShadow = true;
    rail.receiveShadow = true;
    tableGroup.add(rail);

    [1.18, 2.18].forEach((radius) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.012, 8, 128),
        new THREE.MeshStandardMaterial({ color: 0xb57a3a, roughness: 0.48, metalness: 0.36 })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.335;
      tableGroup.add(ring);
    });

    const medallion = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 96),
      new THREE.MeshBasicMaterial({
        map: createZhaTableMedallionTexture(),
        transparent: true,
        toneMapped: false,
      })
    );
    medallion.rotation.x = -Math.PI / 2;
    medallion.position.y = 0.338;
    medallion.renderOrder = 4;
    tableGroup.add(medallion);

    this.scene.add(tableGroup);

    for (let index = 0; index < ZHA_ROOM_SEATS; index += 1) {
      const seat = seatPosition(index, ZHA_ROOM_SEATS, 4.05, 0.82);
      const chairSlot = new THREE.Group();
      chairSlot.name = `Zha_Chair_Slot_${index + 1}`;
      chairSlot.position.set(seat.x, ZHA_ROOM_FLOOR_Y, seat.z);
      chairSlot.rotation.y = Math.atan2(seat.x, seat.z);
      const fallbackChair = this.createZhaRoomChair(index);
      fallbackChair.name = 'Zha_Chair_Procedural_Fallback';
      fallbackChair.position.y = ZHA_PROCEDURAL_CHAIR_FLOOR_OFFSET;
      chairSlot.add(fallbackChair);
      this.zhaRoomChairSlots.push(chairSlot);
      this.scene.add(chairSlot);
    }

    this.loadZhaRoomChairAsset();
  }

  addLibraryShelves() {
    const shelfWood = new THREE.MeshStandardMaterial({ color: 0x2a140c, roughness: 0.68, metalness: 0.1 });
    const bookMaterials = [0x4a1f1f, 0x60472b, 0x253448, 0x1f3d2f, 0x6b4a1e].map((color) => (
      new THREE.MeshStandardMaterial({ color, roughness: 0.74, metalness: 0.04 })
    ));

    const addShelfUnit = (x, z, rotationY = 0) => {
      const group = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.52, 2.8, 0.22), shelfWood);
      frame.position.y = 1.08;
      frame.castShadow = true;
      frame.receiveShadow = true;
      group.add(frame);

      for (let row = 0; row < 4; row += 1) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.045, 0.32), shelfWood);
        shelf.position.set(0, 0.18 + row * 0.55, -0.18);
        shelf.castShadow = true;
        group.add(shelf);

        for (let book = 0; book < 6; book += 1) {
          const width = 0.12 + ((book + row) % 3) * 0.025;
          const height = 0.3 + ((book * 2 + row) % 4) * 0.035;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, 0.08),
            bookMaterials[(book + row) % bookMaterials.length]
          );
          mesh.position.set(-0.58 + book * 0.2, 0.36 + row * 0.55 + height * 0.5, -0.36);
          mesh.rotation.z = ((book % 2) - 0.5) * 0.04;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          group.add(mesh);
        }
      }

      group.position.set(x, 0, z);
      group.rotation.y = rotationY;
      this.scene.add(group);
    };

    [-5.7, -3.8, -1.9, 1.9, 3.8, 5.7].forEach((x) => addShelfUnit(x, -6.45, 0));
    [-4.8, -2.9, 2.9, 4.8].forEach((z) => {
      addShelfUnit(-8.38, z, Math.PI / 2);
      addShelfUnit(8.38, z, -Math.PI / 2);
    });
  }

  async loadZhaRoomChairAsset() {
    if (this.chairAssetStatus === 'loading' || this.chairAssetStatus === 'ready') return;
    this.chairAssetStatus = 'loading';
    try {
      const gltf = await this.gltfLoader.loadAsync(this.chairAssetUrl);
      const source = gltf.scene;
      if (this.disposed) {
        disposeObjectResources(source);
        return;
      }

      source.name = 'Armchair_01_Runtime';
      // The source model's local forward axis points away from the seat opening.
      // Rotate the runtime derivative so every chair faces the table center.
      source.rotation.y += Math.PI;
      source.updateMatrixWorld(true);
      const initialBounds = new THREE.Box3().setFromObject(source);
      const initialSize = initialBounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) {
        throw new Error('Chair model has invalid bounds');
      }

      source.scale.multiplyScalar(ZHA_CHAIR_TARGET_HEIGHT / initialSize.y);
      source.updateMatrixWorld(true);
      const normalizedBounds = new THREE.Box3().setFromObject(source);
      const normalizedCenter = normalizedBounds.getCenter(new THREE.Vector3());
      source.position.x -= normalizedCenter.x;
      source.position.y -= normalizedBounds.min.y;
      source.position.z -= normalizedCenter.z;
      source.updateMatrixWorld(true);

      source.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = true;
      });

      this.chairAssetRoot = source;
      this.chairAssetMetrics = collectModelMetrics(source);
      this.zhaRoomChairSlots.forEach((slot) => {
        slot.clear();
        slot.add(source.clone(true));
      });
      this.chairAssetStatus = 'ready';
    } catch (error) {
      this.chairAssetStatus = 'fallback';
      console.warn('Unable to load optimized chair asset; keeping procedural chairs.', error);
    }
  }

  createZhaRoomChair(index) {
    const group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7d411e, roughness: 0.43, metalness: 0.22 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x30150b, roughness: 0.6, metalness: 0.12 });
    const leather = new THREE.MeshStandardMaterial({ color: index % 2 ? 0x491c18 : 0x381719, roughness: 0.52, metalness: 0.08 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd19442, roughness: 0.36, metalness: 0.46 });

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.18, 0.78), leather);
    seat.position.y = 0.34;
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    const back = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.28, 0.18), leather);
    back.position.set(0, 0.98, 0.42);
    back.castShadow = true;
    back.receiveShadow = true;
    group.add(back);

    const crest = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 48), brass);
    crest.position.set(0, 1.62, 0.31);
    crest.rotation.x = Math.PI / 2;
    group.add(crest);

    const plus = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.46, 0.025),
      new THREE.MeshStandardMaterial({
        color: 0xffc06f,
        emissive: 0x6d3200,
        roughness: 0.32,
        metalness: 0.25,
      })
    );
    plus.position.set(0, 1.28, 0.3);
    group.add(plus);
    const plusCross = plus.clone();
    plusCross.rotation.z = Math.PI / 2;
    group.add(plusCross);

    [-0.5, 0.5].forEach((x) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.82), wood);
      arm.position.set(x, 0.58, -0.02);
      arm.castShadow = true;
      group.add(arm);

      const frontLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.52, 12), darkWood);
      frontLeg.position.set(x, 0.08, -0.28);
      frontLeg.castShadow = true;
      group.add(frontLeg);

      const backLeg = frontLeg.clone();
      backLeg.position.z = 0.34;
      group.add(backLeg);
    });

    return group;
  }

  createZhaPlayerFigure(player, hand, viewerId) {
    const isMe = player.id === viewerId;
    const isTurn = player.id === hand.currentTurnPlayerId;
    const folded = (hand.foldedPlayerIds || []).includes(player.id);
    const jacketColor = isMe ? 0x275948 : isTurn ? 0x8a4d1f : 0x252a32;
    const group = new THREE.Group();

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.36, 0.54, 28),
      new THREE.MeshStandardMaterial({
        color: jacketColor,
        roughness: 0.62,
        metalness: 0.08,
        emissive: isTurn ? 0x2d1600 : 0x000000,
      })
    );
    torso.position.set(0, 0.62, 0.03);
    torso.scale.x = 1.15;
    torso.castShadow = true;
    torso.receiveShadow = true;
    group.add(torso);

    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.018, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xd8c6a6, roughness: 0.5, metalness: 0.08 })
    );
    collar.position.set(0, 0.91, -0.02);
    collar.rotation.x = Math.PI / 2;
    group.add(collar);

    const portraitTexture = this.getAvatarTexture(player.avatarSrc);
    const portraitFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.56, 0.035),
      new THREE.MeshStandardMaterial({
        color: isMe ? 0x87ffe1 : isTurn ? 0xffcb68 : 0x9b6a35,
        roughness: 0.34,
        metalness: 0.42,
        emissive: isTurn ? 0x3a2100 : 0x000000,
      })
    );
    portraitFrame.position.set(0, 1.04, -0.2);
    portraitFrame.rotation.y = Math.PI;
    group.add(portraitFrame);

    const portrait = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.48),
      new THREE.MeshBasicMaterial({
        map: portraitTexture,
        transparent: true,
        toneMapped: false,
      })
    );
    portrait.position.set(0, 1.04, -0.222);
    portrait.rotation.y = Math.PI;
    portrait.renderOrder = 12;
    group.add(portrait);

    [-0.36, 0.36].forEach((x) => {
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.07, 0.5, 16),
        new THREE.MeshStandardMaterial({ color: jacketColor, roughness: 0.66, metalness: 0.06 })
      );
      arm.position.set(x, 0.68, -0.18);
      arm.rotation.z = x > 0 ? -0.74 : 0.74;
      arm.rotation.x = 0.38;
      arm.castShadow = true;
      group.add(arm);
    });

    for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.2, 0.008),
        new THREE.MeshStandardMaterial({
          color: folded ? 0x5b5145 : 0xead8b6,
          roughness: 0.48,
          metalness: 0.02,
        })
      );
      card.position.set((cardIndex - 1) * 0.07, 0.82 + cardIndex * 0.01, -0.38);
      card.rotation.set(0.36, (cardIndex - 1) * 0.16, (cardIndex - 1) * 0.12);
      group.add(card);
    }

    if (isTurn) {
      const turnRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.46, 0.018, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0xffcf70, transparent: true, opacity: 0.78, toneMapped: false })
      );
      turnRing.position.set(0, 1.38, -0.08);
      turnRing.rotation.x = Math.PI / 2;
      group.add(turnRing);
    }

    return group;
  }

  getAvatarTexture(src) {
    if (!src) return createFallbackAvatarTexture();
    if (this.avatarTextures.has(src)) return this.avatarTextures.get(src);
    const texture = this.textureLoader.load(src, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.needsUpdate = true;
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    this.avatarTextures.set(src, texture);
    return texture;
  }

  bindEvents() {
    this.onPointerDown = (event) => {
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        yaw: this.yaw,
        pitch: this.pitch,
        lookYaw: this.lookYawOffset,
        lookPitch: this.lookPitchOffset,
        moved: false,
      };
      this.container.setPointerCapture?.(event.pointerId);
    };

    this.onPointerMove = (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 7) this.drag.moved = true;
      if (this.tableTheme === 'zha_room') {
        this.lookYawOffset = clamp(this.drag.lookYaw - dx * 0.0045, -0.95, 0.95);
        this.lookPitchOffset = clamp(this.drag.lookPitch + dy * 0.0034, -0.34, 0.46);
      } else {
        this.yaw = this.drag.yaw - dx * 0.008;
        this.pitch = clamp(this.drag.pitch + dy * 0.006, 0.44, 1.18);
      }
    };

    this.onPointerUp = (event) => {
      const shouldClick = this.drag && !this.drag.moved;
      this.drag = null;
      this.container.releasePointerCapture?.(event.pointerId);
      if (shouldClick) this.handleSceneClick(event);
    };

    this.onWheel = (event) => {
      event.preventDefault();
      if (this.tableTheme === 'zha_room') return;
      this.distance = clamp(this.distance + event.deltaY * 0.006, 5.8, 10.4);
    };

    this.container.addEventListener('pointerdown', this.onPointerDown);
    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerup', this.onPointerUp);
    this.container.addEventListener('pointercancel', this.onPointerUp);
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
  }

  update(snapshot = {}) {
    this.lastSnapshot = snapshot;
    if (!snapshot.room) {
      this.clearPlayers();
      this.clearCards();
      this.clearPot();
      this.updateTurnTimer('', false, false);
      return;
    }

    const hand = snapshot.hand || {};
    if (hand.id && hand.id !== this.lastHandId) {
      this.lastHandId = hand.id;
      this.dealStartedAt = performance.now();
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const config = snapshot.room.config || {};
    if (this.tableTheme === 'zha_room') {
      this.updateZhaCameraState(snapshot.room.status || 'lobby', players, snapshot.viewerId);
    } else {
      this.alignCameraToViewerSeat(players, snapshot.viewerId);
    }
    const settlement = snapshot.room.lastSettlement || null;
    if (settlement && settlement.settledAt && settlement.settledAt !== this.lastSettlementAt) {
      this.lastSettlementAt = settlement.settledAt;
      this.potCollectAnimation = {
        startedAt: performance.now(),
        winnerIds: settlement.winnerIds || [],
        pot: Number(settlement.pot || 0),
      };
    }
    this.renderPlayers(players, hand, snapshot.viewerId, config);
    this.renderPot(hand, config, players);
    this.updateTurnTimer(
      formatSceneTurnTimer(hand.turnDeadlineAt),
      getSceneTurnRemainingSeconds(hand.turnDeadlineAt) <= 15,
      Boolean(hand.currentTurnPlayerId && hand.turnDeadlineAt)
    );
    this.renderCards(players, hand, snapshot.viewerId);
  }

  renderPlayers(players, hand, viewerId, config) {
    this.clearPlayers();
    const activeIds = new Set(hand.activePlayerIds || []);
    const foldedIds = new Set(hand.foldedPlayerIds || []);
    const viewedIds = new Set(hand.viewedPlayerIds || []);
    const nextTurnPlayerId = findNextTurnPlayerId(players, hand, activeIds);

    players.forEach((player, index) => {
      const seat = seatPosition(index, players.length, LABEL_RADIUS, 0.86);
      const tableSeat = seatPosition(index, players.length, 2.64, 0.76);
      const chipDirection = new THREE.Vector3(tableSeat.x, 0, tableSeat.z).normalize();
      const chipTangent = new THREE.Vector3(-chipDirection.z, 0, chipDirection.x);
      if (this.tableTheme === 'zha_room') {
        const isViewerInActiveHand = player.id === viewerId && Boolean(hand.id);
        if (!isViewerInActiveHand) {
          const figure = this.createZhaPlayerFigure(player, hand, viewerId);
          figure.position.set(seat.x, 0.02, seat.z);
          figure.rotation.y = Math.atan2(seat.x, seat.z);
          this.playersGroup.add(figure);
        }
      } else {
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.16, 0.08, 28),
          new THREE.MeshStandardMaterial({
            color: player.id === hand.currentTurnPlayerId ? 0xf5d77d : player.id === viewerId ? 0x80ddc9 : 0xd9c89c,
            emissive: player.id === hand.currentTurnPlayerId ? 0x5a4200 : 0x000000,
            roughness: 0.44,
            metalness: 0.2,
          })
        );
        marker.position.set(seat.x, 0.43, seat.z);
        marker.castShadow = true;
        this.playersGroup.add(marker);
      }

      const chips = this.createChipStack(player.coins, config, PLAYER_CHIP_LIMIT, 7);
      chips.position
        .set(tableSeat.x, 0.22, tableSeat.z)
        .addScaledVector(chipDirection, -0.28)
        .addScaledVector(chipTangent, 0.36);
      chips.rotation.y = -seat.angle;
      this.playersGroup.add(chips);

      const label = this.getLabel(player.id);
      const hideSceneLabel = this.tableTheme === 'zha_room' && player.id === viewerId && Boolean(hand.id);
      label.hidden = hideSceneLabel;
      if (hideSceneLabel) return;
      label.className = 'table-seat-label';
      label.classList.toggle('is-me', player.id === viewerId);
      label.classList.toggle('is-turn', player.id === hand.currentTurnPlayerId);
      label.classList.toggle('is-next-turn', player.id === nextTurnPlayerId);
      label.classList.toggle('is-folded', foldedIds.has(player.id));
      label.classList.toggle('is-viewed', viewedIds.has(player.id));
      label.classList.toggle('is-active', activeIds.has(player.id));
      label.dataset.playerId = player.id;
      label.__worldPosition = new THREE.Vector3(seat.x, 0.88, seat.z);
      label.querySelector('img').src = player.avatarSrc || '';
      label.querySelector('img').alt = player.avatarLabel || '';
      label.querySelector('strong').textContent = player.nickname || '玩家';
      label.querySelector('span').textContent = `${playerStatus(player, hand)} · ${formatCompactAmount(player.coins)}`;
      label.hidden = false;
    });

    this.labelsById.forEach((label, id) => {
      if (!players.some((player) => player.id === id)) label.hidden = true;
    });
  }

  renderPot(hand, config, players) {
    this.clearPot();
    const pot = Number(hand && hand.pot) || 0;
    const collect = this.potCollectAnimation;
    if (!pot && (!collect || performance.now() - collect.startedAt > 1200)) return;

    const amount = pot || collect.pot || 0;
    const chips = this.createChipStack(amount, config, POT_CHIP_LIMIT, 9);
    chips.position.set(0.62, TABLETOP_PROP_Y, -0.12);
    chips.rotation.y = -0.24;

    if (!pot && collect) {
      const winners = (collect.winnerIds || [])
        .map((id) => players.findIndex((player) => player.id === id))
        .filter((index) => index >= 0);
      const winnerIndex = winners.length ? winners[0] : -1;
      if (winnerIndex >= 0) {
        const seat = seatPosition(winnerIndex, players.length, 2.64, 0.76);
        const target = new THREE.Vector3(seat.x * 0.78, 0.34, seat.z * 0.78);
        chips.userData.collecting = {
          startedAt: collect.startedAt,
          source: chips.position.clone(),
          target,
          sourceRotation: chips.rotation.y,
        };
      }
    }

    this.potGroup.add(chips);
  }

  alignCameraToViewerSeat(players, viewerId) {
    const viewerIndex = players.findIndex((player) => player.id === viewerId);
    if (viewerIndex < 0) return;

    const seatKey = `${viewerId}:${viewerIndex}:${players.length}`;
    if (seatKey === this.cameraSeatKey) return;
    this.cameraSeatKey = seatKey;

    const seat = seatPosition(viewerIndex, players.length, TABLE_RADIUS, 0.78);
    const dir = new THREE.Vector3(seat.x, 0, seat.z).normalize();
    this.yaw = Math.atan2(dir.x, dir.z);
  }

  renderCards(players, hand, viewerId) {
    this.clearCards();
    if (!hand || !hand.id) return;

    const activeIds = new Set(hand.activePlayerIds || []);
    const foldedIds = new Set(hand.foldedPlayerIds || []);
    const viewedIds = new Set(hand.viewedPlayerIds || []);
    const myCards = Array.isArray(hand.myCards) ? hand.myCards : null;
    const startPosition = new THREE.Vector3(0, 0.62, -0.36);

    players.forEach((player, playerIndex) => {
      const base = seatPosition(playerIndex, players.length, TABLE_RADIUS, 0.78);
      const dir = new THREE.Vector3(base.x, 0, base.z).normalize();
      const tangent = new THREE.Vector3(-dir.z, 0, dir.x);
      const viewed = viewedIds.has(player.id);
      const folded = foldedIds.has(player.id);
      const active = activeIds.has(player.id);
      if (!active && !folded) return;

      for (let cardIndex = 0; cardIndex < 3; cardIndex += 1) {
        const visibleCard = player.id === viewerId && myCards ? myCards[cardIndex] : null;
        const mesh = this.createCardMesh(visibleCard, !visibleCard);
        const spread = viewed ? (1 - cardIndex) * VIEWED_CARD_SPACING : (cardIndex - 1) * TABLE_CARD_SPACING;
        const basePosition = new THREE.Vector3(base.x, 0.42, base.z).addScaledVector(tangent, spread);
        const angle = Math.atan2(dir.x, dir.z);

        if (viewed) {
          mesh.position.copy(basePosition).addScaledVector(dir, -0.1);
          mesh.position.y = 0.78;
          mesh.rotation.set(0, angle, 0);
        } else if (folded) {
          mesh.position.copy(basePosition).addScaledVector(dir, -0.1);
          mesh.rotation.set(-Math.PI / 2, 0, angle + (cardIndex - 1) * 0.2);
          mesh.material.opacity = 0.55;
        } else {
          mesh.position.copy(basePosition);
          mesh.rotation.set(-Math.PI / 2, 0, angle + (cardIndex - 1) * 0.08);
        }

        mesh.userData.targetPosition = mesh.position.clone();
        mesh.userData.targetQuaternion = mesh.quaternion.clone();
        mesh.userData.startPosition = startPosition.clone();
        mesh.userData.delay = playerIndex * 80 + cardIndex * players.length * 36;
        mesh.userData.shouldAnimate = Boolean(hand.id === this.lastHandId && performance.now() - this.dealStartedAt < 1600);
        if (mesh.userData.shouldAnimate) {
          mesh.position.copy(startPosition);
          mesh.quaternion.copy(this.deck.quaternion);
        }

        mesh.userData.playerId = player.id;
        mesh.renderOrder = viewed ? 20 + cardIndex : 0;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        this.cardsGroup.add(mesh);
        this.cardMeshes.push(mesh);
      }
    });
  }

  createCardMesh(card, isBack) {
    const frontTexture = this.getCardTexture(card, isBack);
    const backTexture = this.getCardTexture(null, true);
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const frontMaterial = new THREE.MeshBasicMaterial({
      map: frontTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const backMaterial = new THREE.MeshBasicMaterial({
      map: backTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });

    return new THREE.Mesh(
      new THREE.BoxGeometry(CARD_SIZE.width, CARD_SIZE.height, CARD_THICKNESS),
      [edgeMaterial, edgeMaterial, edgeMaterial, edgeMaterial, frontMaterial, backMaterial]
    );
  }

  getCardTexture(card, isBack) {
    const key = isBack ? 'back' : cardAssetId(card);
    if (this.cardTextureCache.has(key)) return this.cardTextureCache.get(key);

    const assetUrl = isBack
      ? `${this.cardAssetBaseUrl}/back.webp`
      : `${this.cardAssetBaseUrl}/front/${encodeURIComponent(key)}.webp`;
    const texture = this.textureLoader.load(
      assetUrl,
      () => {
        texture.userData.assetStatus = 'ready';
      },
      undefined,
      () => {
        const fallback = createCardTexture(card, isBack);
        texture.image = fallback.image;
        texture.needsUpdate = true;
        texture.userData.assetStatus = 'fallback';
        texture.userData.assetFallback = true;
        fallback.dispose();
      }
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.userData.assetUrl = assetUrl;
    texture.userData.assetStatus = 'loading';
    this.cardTextureCache.set(key, texture);
    return texture;
  }

  installTurnTimerDevice() {
    this.turnTimerCanvas = document.createElement('canvas');
    this.turnTimerCanvas.width = 512;
    this.turnTimerCanvas.height = 296;
    this.turnTimerContext = this.turnTimerCanvas.getContext('2d');
    this.turnTimerTexture = new THREE.CanvasTexture(this.turnTimerCanvas);
    this.turnTimerTexture.colorSpace = THREE.SRGBColorSpace;
    this.turnTimerTexture.anisotropy = 4;
    this.turnTimerMaterial = new THREE.MeshBasicMaterial({
      map: this.turnTimerTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const timerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(TABLE_TIMER_SIZE.width, TABLE_TIMER_SIZE.height),
      this.turnTimerMaterial
    );
    timerPlane.renderOrder = 19;
    this.turnTimerGroup.add(timerPlane);
    this.turnTimerGroup.position.copy(TABLE_TIMER_POSITION);
    this.turnTimerGroup.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - 0.12);
    this.turnTimerGroup.visible = false;
    this.drawTurnTimerDevice('00:00', false);
  }

  updateTurnTimer(text, isWarning = false, visible = true) {
    const shouldShow = Boolean(visible && text);
    this.turnTimerGroup.visible = shouldShow;
    if (!shouldShow) return;
    if (text === this.turnTimerText && isWarning === this.turnTimerWarning) return;
    this.turnTimerText = text;
    this.turnTimerWarning = isWarning;
    this.drawTurnTimerDevice(text, isWarning);
  }

  drawTurnTimerDevice(text, isWarning) {
    const ctx = this.turnTimerContext;
    const width = this.turnTimerCanvas.width;
    const height = this.turnTimerCanvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.34)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 18;
    roundRect(ctx, 26, 24, width - 52, height - 48, 34);
    const bodyGradient = ctx.createLinearGradient(0, 24, 0, height - 24);
    bodyGradient.addColorStop(0, '#a76b32');
    bodyGradient.addColorStop(0.24, '#7e4a23');
    bodyGradient.addColorStop(1, '#452413');
    ctx.fillStyle = bodyGradient;
    ctx.fill();
    ctx.restore();

    roundRect(ctx, 38, 38, width - 76, height - 76, 28);
    ctx.strokeStyle = isWarning ? 'rgba(255, 82, 82, 0.9)' : 'rgba(225, 93, 78, 0.58)';
    ctx.lineWidth = 7;
    ctx.stroke();

    roundRect(ctx, 70, 78, width - 140, 116, 16);
    const screenGradient = ctx.createLinearGradient(0, 78, 0, 194);
    screenGradient.addColorStop(0, '#0a3519');
    screenGradient.addColorStop(0.5, '#062412');
    screenGradient.addColorStop(1, '#06150c');
    ctx.fillStyle = screenGradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(71, 144, 64, 0.36)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.font = '900 72px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isWarning ? '#ff4646' : '#42ff5d';
    ctx.shadowColor = isWarning ? 'rgba(255, 70, 70, 0.62)' : 'rgba(66, 255, 93, 0.5)';
    ctx.shadowBlur = 14;
    ctx.fillText(text, width / 2, 137);
    ctx.shadowBlur = 0;

    [202, 256, 310].forEach((x) => {
      ctx.beginPath();
      ctx.arc(x, 232, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#172014';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 210, 128, 0.12)';
      ctx.lineWidth = 3;
      ctx.stroke();
    });

    ctx.fillStyle = 'rgba(255, 226, 155, 0.14)';
    ctx.fillRect(45, 42, width - 90, 44);
    this.turnTimerTexture.needsUpdate = true;
  }

  getLabel(playerId) {
    if (this.labelsById.has(playerId)) return this.labelsById.get(playerId);

    const label = document.createElement('article');
    label.innerHTML = `
      <img alt="">
      <div>
        <strong></strong>
        <span></span>
      </div>
    `;
    this.labelLayer.appendChild(label);
    this.labelsById.set(playerId, label);
    return label;
  }

  clearPlayers() {
    while (this.playersGroup.children.length) this.playersGroup.remove(this.playersGroup.children[0]);
    this.labelsById.forEach((label) => {
      label.hidden = true;
    });
  }

  clearPot() {
    while (this.potGroup.children.length) this.potGroup.remove(this.potGroup.children[0]);
  }

  clearCards() {
    this.cardMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      disposeMaterial(mesh.material, { disposeTextures: false });
    });
    this.cardMeshes = [];
    while (this.cardsGroup.children.length) this.cardsGroup.remove(this.cardsGroup.children[0]);
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  updateZhaCameraState(roomStatus, players, viewerId) {
    const mode = roomStatus === 'playing' ? 'first_person' : 'overview';
    const viewerIndex = players.findIndex((player) => player.id === viewerId);
    const key = `${mode}:${viewerId || 'guest'}:${viewerIndex}:${players.length}`;
    const pose = this.getZhaCameraPose(mode, players, viewerId);
    this.cameraDesiredPose = pose;
    this.updateZhaViewerChairVisibility(mode, players, viewerIndex);
    if (key === this.cameraRoomKey) return;

    this.cameraRoomKey = key;
    this.cameraMode = mode;
    this.cameraTransition = {
      startedAt: performance.now(),
      duration: ZHA_CAMERA_TRANSITION_MS,
      fromPosition: this.camera.position.clone(),
      fromTarget: this.rayTarget.clone(),
      fromFov: this.camera.fov,
      toPosition: pose.position.clone(),
      toTarget: pose.target.clone(),
      toFov: pose.fov,
    };
    if (mode !== 'first_person') {
      this.lookYawOffset = 0;
      this.lookPitchOffset = 0;
    }
  }

  updateZhaViewerChairVisibility(mode, players, viewerIndex) {
    this.zhaRoomChairSlots.forEach((slot) => {
      slot.visible = true;
    });
    if (mode !== 'first_person' || viewerIndex < 0 || !this.zhaRoomChairSlots.length) return;

    const viewerSeat = seatPosition(viewerIndex, Math.max(2, players.length || 2), 4.05, 0.82);
    let closestSlot = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    this.zhaRoomChairSlots.forEach((slot) => {
      const distance = Math.hypot(slot.position.x - viewerSeat.x, slot.position.z - viewerSeat.z);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSlot = slot;
      }
    });
    if (closestSlot) closestSlot.visible = false;
  }

  getZhaCameraPose(mode, players, viewerId) {
    if (mode === 'first_person') {
      const count = Math.max(2, players.length || 2);
      const viewerIndex = Math.max(0, players.findIndex((player) => player.id === viewerId));
      const seat = seatPosition(viewerIndex, count, 4.58, 0.82);
      const inward = new THREE.Vector3(-seat.x, 0, -seat.z).normalize();
      const position = new THREE.Vector3(seat.x, 2.05, seat.z).addScaledVector(inward, 0.08);
      const target = new THREE.Vector3(0, 0.85, 0).addScaledVector(inward, 0.05);
      return { position, target, fov: 58 };
    }

    return {
      position: new THREE.Vector3(0.35, 6.25, 5.85),
      target: new THREE.Vector3(0, 0.26, 0),
      fov: 38,
    };
  }

  applyCameraPose(pose) {
    this.camera.position.copy(pose.position);
    this.rayTarget.copy(pose.target);
    if (this.camera.fov !== pose.fov) {
      this.camera.fov = pose.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.rayTarget);
  }

  renderFrame(now) {
    if (this.disposed) return;
    this.updateCamera(now);
    this.animateCards(now);
    this.animatePotCollect(now);
    this.positionLabels();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.renderFrame);
  }

  updateCamera(now = performance.now()) {
    if (this.tableTheme === 'zha_room') {
      this.updateZhaCamera(now);
      return;
    }

    const radius = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      Math.sin(this.yaw) * radius,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * radius
    );
    this.camera.lookAt(this.rayTarget);
  }

  updateZhaCamera(now) {
    const desired = this.cameraDesiredPose || this.getZhaCameraPose('overview', [], '');
    if (this.cameraTransition) {
      const progress = clamp((now - this.cameraTransition.startedAt) / this.cameraTransition.duration, 0, 1);
      const eased = easeInOutCubic(progress);
      this.camera.position.lerpVectors(this.cameraTransition.fromPosition, this.cameraTransition.toPosition, eased);
      this.rayTarget.lerpVectors(this.cameraTransition.fromTarget, this.cameraTransition.toTarget, eased);
      this.camera.fov = lerp(this.cameraTransition.fromFov, this.cameraTransition.toFov, eased);
      this.camera.updateProjectionMatrix();
      if (progress >= 1) this.cameraTransition = null;
    } else {
      this.applyCameraPose(desired);
    }

    const lookTarget = this.rayTarget.clone();
    if (this.cameraMode === 'first_person') {
      const forward = lookTarget.clone().sub(this.camera.position).normalize();
      const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
      lookTarget.addScaledVector(right, Math.sin(this.lookYawOffset) * 3.2);
      lookTarget.y += this.lookPitchOffset * 2.8;
    }
    this.camera.lookAt(lookTarget);
  }

  animateCards(now) {
    const elapsed = now - this.dealStartedAt;
    this.cardMeshes.forEach((mesh) => {
      if (!mesh.userData.shouldAnimate) return;
      const progress = clamp((elapsed - mesh.userData.delay) / 520, 0, 1);
      const eased = easeOutCubic(progress);
      mesh.position.lerpVectors(mesh.userData.startPosition, mesh.userData.targetPosition, eased);
      mesh.quaternion.slerpQuaternions(this.deck.quaternion, mesh.userData.targetQuaternion, eased);
      if (progress >= 1) mesh.userData.shouldAnimate = false;
    });
  }

  animatePotCollect(now) {
    const stack = this.potGroup.children.find((child) => child.userData.collecting);
    if (!stack) return;
    const collect = stack.userData.collecting;
    const progress = clamp((now - collect.startedAt) / 920, 0, 1);
    const eased = easeOutCubic(progress);
    stack.position.lerpVectors(collect.source, collect.target, eased);
    stack.scale.setScalar(1 - eased * 0.26);
    stack.rotation.y = collect.sourceRotation + eased * 1.8;
    if (progress >= 1) {
      this.clearPot();
      this.potCollectAnimation = null;
    }
  }

  createChipStack(amount, config, maxVisibleChips, maxStackHeight) {
    const group = new THREE.Group();
    const plan = createChipPlan(amount, config, maxVisibleChips);
    const stackGap = 0.18;
    const rowWidth = Math.min(4, plan.length);

    if (!rowWidth) return group;

    plan.forEach((entry, planIndex) => {
      const col = planIndex % rowWidth;
      const row = Math.floor(planIndex / rowWidth);
      const visibleCount = Math.min(entry.count, maxStackHeight);
      const stackX = (col - (rowWidth - 1) / 2) * stackGap + (row % 2) * 0.06;
      const stackZ = row * 0.16;
      for (let chipIndex = 0; chipIndex < visibleCount; chipIndex += 1) {
        const chip = this.createChipMesh(entry.denomination);
        chip.position.set(
          stackX + Math.sin((chipIndex + planIndex) * 1.7) * 0.006,
          chipIndex * CHIP_HEIGHT,
          stackZ + Math.cos((chipIndex + planIndex) * 1.3) * 0.005
        );
        chip.rotation.y = (chipIndex % 4) * 0.18;
        chip.castShadow = false;
        chip.receiveShadow = false;
        group.add(chip);
      }

      if (!visibleCount) return;
      const crown = this.createChipCrown(entry.denomination);
      crown.position.set(stackX, visibleCount * CHIP_HEIGHT + 0.006, stackZ);
      group.add(crown);
    });

    return group;
  }

  createChipMesh(denomination) {
    const materials = this.getChipMaterials(denomination);
    return new THREE.Mesh(CHIP_GEOMETRY, [materials.edge, materials.face, materials.face]);
  }

  createChipCrown(denomination) {
    const materials = this.getChipMaterials(denomination);
    const crown = new THREE.Mesh(
      new THREE.TorusGeometry(CHIP_RADIUS * 0.74, 0.006, 6, 28),
      materials.edge
    );
    crown.rotation.x = Math.PI / 2;
    return crown;
  }

  getChipMaterials(denomination) {
    const key = String(denomination);
    if (this.materialsByDenomination.has(key)) return this.materialsByDenomination.get(key);

    const index = this.materialsByDenomination.size % CHIP_PALETTES.length;
    const palette = CHIP_PALETTES[index];
    const texture = createChipFaceTexture(denomination, palette);
    const materials = {
      face: new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.32,
        metalness: 0.24,
      }),
      edge: new THREE.MeshStandardMaterial({
        color: palette.edge,
        roughness: 0.38,
        metalness: 0.28,
      }),
    };
    this.materialsByDenomination.set(key, materials);
    return materials;
  }

  positionLabels() {
    const rect = this.container.getBoundingClientRect();
    const topInset = 6;
    const bottomInset = document.body.classList.contains('is-in-room') ? Math.min(190, rect.height * 0.28) : 6;
    this.labelsById.forEach((label) => {
      if (label.hidden || !label.__worldPosition) return;
      const projected = label.__worldPosition.clone().project(this.camera);
      const labelWidth = label.offsetWidth || 140;
      const labelHeight = label.offsetHeight || 52;
      const x = clamp((projected.x * 0.5 + 0.5) * rect.width, labelWidth / 2 + 6, rect.width - labelWidth / 2 - 6);
      const y = clamp(
        (-projected.y * 0.5 + 0.5) * rect.height,
        labelHeight / 2 + topInset,
        rect.height - labelHeight / 2 - bottomInset
      );
      label.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      label.style.zIndex = String(Math.round((1 - projected.z) * 1000));
    });
  }

  handleSceneClick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.cardMeshes, false)[0];
    const playerId = hit && hit.object.userData.playerId;
    if (!playerId) return;
    this.container.dispatchEvent(new CustomEvent('sfg-table-card-click', {
      bubbles: true,
      detail: { playerId },
    }));
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerup', this.onPointerUp);
    this.container.removeEventListener('pointercancel', this.onPointerUp);
    this.container.removeEventListener('wheel', this.onWheel);
    this.clearCards();
    if (this.deck) {
      this.deck.geometry.dispose();
      disposeMaterial(this.deck.material, { disposeTextures: false });
    }
    this.cardTextureCache.forEach((texture) => texture.dispose());
    this.cardTextureCache.clear();
    disposeObjectResources(this.chairAssetRoot);
    this.chairAssetRoot = null;
    this.turnTimerTexture?.dispose();
    this.turnTimerMaterial?.dispose();
    this.sceneMaterials.forEach((material) => disposeMaterial(material));
    this.sceneMaterials.clear();
    this.materialsByDenomination.forEach((materials) => {
      materials.face.map?.dispose();
      materials.face.dispose();
      materials.edge.dispose();
    });
    this.materialsByDenomination.clear();
    this.renderer.dispose();
  }
}

function drawCard(ctx, width, height, card, isBack) {
  roundRect(ctx, 10, 10, width - 20, height - 20, 28);
  ctx.fillStyle = isBack ? '#123742' : '#fff9eb';
  ctx.fill();

  if (isBack) {
    ctx.fillStyle = '#0b252d';
    roundRect(ctx, 34, 34, width - 68, height - 68, 20);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 248, 226, 0.9)';
    ctx.font = '900 42px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText('SFG', width / 2, height / 2 + 14);
    ctx.font = '900 58px Georgia';
    ctx.fillText('♠', width / 2, height / 2 - 42);
    return;
  }

  const suit = SUITS[card.suit] || card.suit || '?';
  const rank = String(card.rank || '?');
  const red = RED_SUITS.has(card.suit);
  ctx.fillStyle = red ? '#b52d37' : '#1b2328';
  ctx.textAlign = 'center';
  drawCardCorner(ctx, rank, suit, 45, 64, 0);
  drawCardCorner(ctx, rank, suit, width - 45, height - 48, Math.PI);

  ctx.font = '900 118px Georgia';
  ctx.fillText(suit, width / 2, height / 2 + 46);
}

function drawCardCorner(ctx, rank, suit, x, y, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.font = '900 44px Georgia';
  ctx.fillText(rank, 0, 0);
  ctx.font = '900 38px Georgia';
  ctx.fillText(suit, 0, 42);
  ctx.restore();
}

function createCardTexture(card, isBack) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 376;
  const ctx = canvas.getContext('2d');
  drawCard(ctx, canvas.width, canvas.height, card, isBack);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function cardAssetId(card) {
  return `${String(card?.rank || '')}${String(card?.suit || '')}`;
}

function createWarmOakMaterial(options = {}) {
  const repeat = options.repeat || [2.8, 1];
  return new THREE.MeshPhysicalMaterial({
    color: options.color || 0xb9793d,
    map: createOakColorTexture({ repeat, dark: false }),
    roughness: options.roughness ?? 0.62,
    roughnessMap: createOakRoughnessTexture({ repeat, dark: false }),
    metalness: 0,
    bumpMap: createOakBumpTexture({ repeat, dark: false }),
    bumpScale: options.bumpScale ?? 0.016,
    clearcoat: options.clearcoat ?? 0.1,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.78,
    envMapIntensity: options.envMapIntensity ?? 0.46,
  });
}

function createDarkWoodMaterial(options = {}) {
  const repeat = options.repeat || [1.6, 0.8];
  return new THREE.MeshPhysicalMaterial({
    color: options.color || 0x3b1e10,
    map: createOakColorTexture({ repeat, dark: true }),
    roughness: options.roughness ?? 0.66,
    roughnessMap: createOakRoughnessTexture({ repeat, dark: true }),
    metalness: 0,
    bumpMap: createOakBumpTexture({ repeat, dark: true }),
    bumpScale: options.bumpScale ?? 0.01,
    clearcoat: options.clearcoat ?? 0.08,
    clearcoatRoughness: options.clearcoatRoughness ?? 0.82,
    envMapIntensity: options.envMapIntensity ?? 0.38,
  });
}

function createOakColorTexture({ repeat = [1, 1], dark = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const palette = dark
    ? ['#2a150b', '#3a1e0f', '#4a2915', '#261209']
    : ['#8e5428', '#ad6d35', '#c28749', '#78401f'];
  const base = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  base.addColorStop(0, palette[0]);
  base.addColorStop(0.34, palette[1]);
  base.addColorStop(0.68, palette[2]);
  base.addColorStop(1, palette[3]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i += 1) {
    const y = 22 + i * 19 + Math.sin(i * 1.7) * 7;
    const alpha = dark ? 0.12 : 0.105;
    ctx.strokeStyle = `rgba(${dark ? '124, 74, 39' : '114, 61, 27'}, ${alpha})`;
    ctx.lineWidth = i % 4 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(-30, y);
    ctx.bezierCurveTo(260, y - 10 + Math.sin(i) * 13, 560, y + 13, canvas.width + 30, y + Math.cos(i) * 7);
    ctx.stroke();
  }

  for (let i = 0; i < 8; i += 1) {
    const x = 70 + i * 118;
    const y = 52 + ((i * 37) % 142);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 70);
    glow.addColorStop(0, dark ? 'rgba(255, 177, 94, 0.07)' : 'rgba(255, 236, 184, 0.16)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - 76, y - 76, 152, 152);
  }

  return createPreparedCanvasTexture(canvas, { repeat, colorSpace: THREE.SRGBColorSpace, anisotropy: 8 });
}

function createOakRoughnessTexture({ repeat = [1, 1], dark = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = dark ? '#9b9b9b' : '#969696';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 10; i += 1) {
    const y = 8 + i * 12;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(196, 196, 196, 0.22)' : 'rgba(104, 104, 104, 0.13)';
    ctx.lineWidth = i % 3 === 0 ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(160, y + Math.sin(i * 2.1) * 8, 350, y - 6, canvas.width, y + Math.cos(i) * 5);
    ctx.stroke();
  }

  return createPreparedCanvasTexture(canvas, { repeat, anisotropy: 6 });
}

function createOakBumpTexture({ repeat = [1, 1], dark = false } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';

  for (let i = 0; i < 14; i += 1) {
    const y = 7 + i * 9 + Math.sin(i) * 3;
    ctx.strokeStyle = i % 4 === 0
      ? (dark ? 'rgba(106, 106, 106, 0.24)' : 'rgba(112, 112, 112, 0.20)')
      : (dark ? 'rgba(150, 150, 150, 0.16)' : 'rgba(156, 156, 156, 0.14)');
    ctx.lineWidth = i % 4 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(-20, y);
    ctx.bezierCurveTo(140, y - 4, 320, y + Math.sin(i * 1.3) * 7, canvas.width + 20, y + 2);
    ctx.stroke();
  }

  return createPreparedCanvasTexture(canvas, { repeat, anisotropy: 6 });
}

function createPreparedCanvasTexture(canvas, { repeat = [1, 1], colorSpace, anisotropy = 4 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (colorSpace) texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function applyBoardGameWoodTableMaterials(root) {
  if (!root || typeof root.traverse !== 'function') return { root, materials: [] };

  const tableTopMaterial = createWarmOakMaterial({ repeat: [3.2, 1.1], bumpScale: 0.012 });
  const supportMaterial = createDarkWoodMaterial({ repeat: [1.35, 0.8], bumpScale: 0.008 });
  const assignedMaterials = new Set();
  const disposedOriginals = new Set();

  root.traverse((object) => {
    if (!object.isMesh) return;
    const name = object.name || '';
    let replacement = null;
    if (name === 'Tabletop_Solid' || name.includes('Tabletop')) replacement = tableTopMaterial;
    else if (name.startsWith('Table_Leg') || name.startsWith('Table_Apron')) replacement = supportMaterial;
    if (!replacement) return;

    const previousMaterials = Array.isArray(object.material) ? object.material : [object.material];
    previousMaterials.forEach((material) => {
      if (material && !disposedOriginals.has(material)) {
        disposeMaterial(material);
        disposedOriginals.add(material);
      }
    });
    object.material = replacement;
    object.castShadow = true;
    object.receiveShadow = true;
    assignedMaterials.add(replacement);
  });

  return { root, materials: Array.from(assignedMaterials) };
}

function createWoodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, '#6b381e');
  gradient.addColorStop(0.34, '#9a5a2e');
  gradient.addColorStop(0.62, '#5c2d17');
  gradient.addColorStop(1, '#a56837');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 6) {
    ctx.strokeStyle = y % 18 === 0 ? 'rgba(45, 20, 8, 0.36)' : 'rgba(255, 218, 158, 0.16)';
    ctx.lineWidth = y % 18 === 0 ? 2 : 1;
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += 20) {
      const wave = Math.sin((x + y * 3) * 0.025) * 4;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.8, 1);
  return texture;
}

function createRedFeltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6f1514';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 9000; i += 1) {
    const shade = 34 + Math.floor(Math.random() * 64);
    const alpha = 0.08 + Math.random() * 0.18;
    ctx.fillStyle = `rgba(${shade + 80}, ${shade * 0.42}, ${shade * 0.36}, ${alpha})`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
  }

  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#c44936';
  for (let y = 0; y < canvas.height; y += 7) {
    ctx.beginPath();
    ctx.moveTo(0, y + Math.sin(y) * 1.5);
    ctx.lineTo(canvas.width, y + Math.cos(y) * 1.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 4);
  return texture;
}

function createForestBackdropTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#3d4f22');
  gradient.addColorStop(0.45, '#18210f');
  gradient.addColorStop(1, '#0d1009');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 120; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.72;
    const radius = 12 + Math.random() * 48;
    const leaf = ctx.createRadialGradient(x, y, 0, x, y, radius);
    leaf.addColorStop(0, `rgba(${90 + Math.random() * 80}, ${120 + Math.random() * 80}, 45, 0.24)`);
    leaf.addColorStop(1, 'rgba(12, 20, 9, 0)');
    ctx.fillStyle = leaf;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let fallbackAvatarTexture = null;

function createFallbackAvatarTexture() {
  if (fallbackAvatarTexture) return fallbackAvatarTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 92, 16, 128, 128, 132);
  gradient.addColorStop(0, '#ffe3aa');
  gradient.addColorStop(0.45, '#a65d2a');
  gradient.addColorStop(1, '#20100a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#0d0907';
  ctx.beginPath();
  ctx.arc(128, 104, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d1710';
  roundRect(ctx, 70, 146, 116, 76, 26);
  ctx.fill();
  ctx.fillStyle = '#ffe6b0';
  ctx.font = '900 42px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText('TAW', 128, 198);
  fallbackAvatarTexture = new THREE.CanvasTexture(canvas);
  fallbackAvatarTexture.colorSpace = THREE.SRGBColorSpace;
  return fallbackAvatarTexture;
}

function createDarkWoodFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a0f0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 46) {
    const plankGradient = ctx.createLinearGradient(0, y, canvas.width, y + 42);
    plankGradient.addColorStop(0, y % 92 === 0 ? '#2d180d' : '#21120a');
    plankGradient.addColorStop(0.5, '#3c2111');
    plankGradient.addColorStop(1, '#160b07');
    ctx.fillStyle = plankGradient;
    ctx.fillRect(0, y, canvas.width, 42);
    ctx.strokeStyle = 'rgba(8, 4, 2, 0.78)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, y + 42);
    ctx.lineTo(canvas.width, y + 42);
    ctx.stroke();

    for (let x = 0; x < canvas.width; x += 64) {
      ctx.strokeStyle = 'rgba(255, 205, 122, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 8 + Math.sin(x + y) * 4);
      ctx.lineTo(x + 54, y + 16 + Math.cos(x * 0.2) * 5);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2.2);
  return texture;
}

function createLibraryWallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const background = ctx.createLinearGradient(0, 0, 0, canvas.height);
  background.addColorStop(0, '#2a150d');
  background.addColorStop(0.6, '#120907');
  background.addColorStop(1, '#080403');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let shelf = 0; shelf < 5; shelf += 1) {
    const y = 54 + shelf * 84;
    ctx.fillStyle = '#3c1e0e';
    ctx.fillRect(0, y + 58, canvas.width, 10);
    for (let book = 0; book < 42; book += 1) {
      const x = book * 13 + ((shelf + book) % 4);
      const height = 26 + ((book * 7 + shelf) % 24);
      const colors = ['#5b2422', '#6b4a22', '#243d46', '#244531', '#77603a'];
      ctx.fillStyle = colors[(book + shelf) % colors.length];
      ctx.fillRect(x, y + 58 - height, 8 + (book % 3), height);
      ctx.fillStyle = 'rgba(255, 221, 150, 0.12)';
      ctx.fillRect(x + 2, y + 61 - height, 1, Math.max(8, height - 8));
    }
  }

  ctx.fillStyle = 'rgba(255, 178, 86, 0.1)';
  for (let i = 0; i < 20; i += 1) {
    ctx.beginPath();
    ctx.arc(24 + i * 25, 28 + (i % 4) * 9, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1);
  return texture;
}

function createZhaTableMedallionTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const gradient = ctx.createRadialGradient(256, 220, 40, 256, 256, 230);
  gradient.addColorStop(0, 'rgba(255, 204, 113, 0.92)');
  gradient.addColorStop(0.45, 'rgba(151, 82, 31, 0.78)');
  gradient.addColorStop(1, 'rgba(43, 20, 10, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(256, 256, 238, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 221, 151, 0.78)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(256, 256, 174, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(42, 16, 8, 0.72)';
  for (let spoke = 0; spoke < 12; spoke += 1) {
    const angle = (spoke / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(angle) * 92, 256 + Math.sin(angle) * 92);
    ctx.lineTo(256 + Math.cos(angle) * 168, 256 + Math.sin(angle) * 168);
    ctx.stroke();
  }

  ctx.fillStyle = '#2a1208';
  ctx.font = '900 88px Georgia';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ZHA', 256, 248);
  ctx.font = '800 34px Georgia';
  ctx.fillStyle = 'rgba(255, 235, 180, 0.82)';
  ctx.fillText('TABLE ANY WHERE', 256, 326);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function normalizeTableTheme(theme) {
  return TABLE_THEME_KEYS.has(theme) ? theme : 'classic';
}

function normalizeTableAsset(asset) {
  return TABLE_ASSET_KEYS.has(asset) ? asset : 'procedural_zha_round';
}

function normalizeAssetBaseUrl(url) {
  return String(url || '').replace(/\/+$/g, '') || DEFAULT_CARD_ASSET_BASE_URL;
}

function collectModelMetrics(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  let triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry || geometries.has(object.geometry)) return;
    geometries.add(object.geometry);
    const indexCount = object.geometry.index?.count;
    const vertexCount = object.geometry.attributes?.position?.count || 0;
    triangles += Math.floor((indexCount || vertexCount) / 3);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    meshMaterials.forEach((material) => {
      if (!material) return;
      materials.add(material);
      ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach((key) => {
        if (material[key]) textures.add(material[key]);
      });
    });
  });
  return {
    triangles,
    geometries: geometries.size,
    materials: materials.size,
    textures: textures.size,
  };
}

function disposeObjectResources(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (object.geometry) geometries.add(object.geometry);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    meshMaterials.forEach((material) => {
      if (material) materials.add(material);
    });
  });
  geometries.forEach((geometry) => geometry.dispose());
  disposeMaterial([...materials]);
}

function formatSceneTurnTimer(deadlineAt) {
  if (!deadlineAt) return '';
  const remainingSeconds = getSceneTurnRemainingSeconds(deadlineAt);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getSceneTurnRemainingSeconds(deadlineAt) {
  if (!deadlineAt) return 0;
  return Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
}

function disposeMaterial(material, options = {}) {
  const materials = Array.isArray(material) ? material : [material];
  const disposed = new Set();
  const disposedTextures = new Set();
  const shouldDisposeTextures = options.disposeTextures !== false;
  const textureKeys = [
    'map',
    'alphaMap',
    'aoMap',
    'bumpMap',
    'clearcoatMap',
    'clearcoatNormalMap',
    'clearcoatRoughnessMap',
    'displacementMap',
    'emissiveMap',
    'envMap',
    'lightMap',
    'metalnessMap',
    'normalMap',
    'roughnessMap',
    'sheenColorMap',
    'sheenRoughnessMap',
    'specularColorMap',
    'specularIntensityMap',
    'thicknessMap',
    'transmissionMap',
  ];
  materials.forEach((item) => {
    if (!item || disposed.has(item)) return;
    if (shouldDisposeTextures) {
      textureKeys.forEach((key) => {
        const texture = item[key];
        if (texture && !disposedTextures.has(texture)) {
          texture.dispose();
          disposedTextures.add(texture);
        }
      });
    }
    item.dispose();
    disposed.add(item);
  });
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function seatPosition(index, count, radius, zScale) {
  const safeCount = Math.max(2, count || 2);
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / safeCount;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius * zScale,
    angle,
  };
}

function findNextTurnPlayerId(players, hand, activeIds) {
  if (!hand || !hand.currentTurnPlayerId || activeIds.size < 2) return '';
  const orderedActivePlayers = players.filter((player) => activeIds.has(player.id));
  const currentIndex = orderedActivePlayers.findIndex((player) => player.id === hand.currentTurnPlayerId);
  if (currentIndex === -1) return orderedActivePlayers[0] ? orderedActivePlayers[0].id : '';
  return orderedActivePlayers[(currentIndex + 1) % orderedActivePlayers.length].id;
}

function playerStatus(player, hand) {
  const tags = [];
  if (player.isHost) tags.push('房主');
  if (player.connected === false) tags.push('离线');
  if ((hand.foldedPlayerIds || []).includes(player.id)) tags.push('弃牌');
  if ((hand.viewedPlayerIds || []).includes(player.id)) tags.push('已看牌');
  if (hand.currentTurnPlayerId === player.id) tags.push('行动中');
  if (!tags.length) tags.push(`座位 ${player.seat || '-'}`);
  return tags.join(' · ');
}

function createChipPlan(amount, config, maxVisibleChips) {
  const total = Math.max(0, Math.floor(Number(amount) || 0));
  const denominations = getChipDenominations(config);
  if (!total || !denominations.length) return [];

  const counts = allocateChipCounts(total, denominations);
  const plan = denominations.map((denomination, index) => ({
    denomination,
    count: counts[index] || 0,
  }));

  return capChipPlan(plan, maxVisibleChips);
}

function allocateChipCounts(total, denominations) {
  const counts = new Array(denominations.length).fill(0);
  const groupValue = denominations.reduce((sum, denomination) => sum + denomination, 0);
  const baseCount = Math.floor(total / groupValue);
  let remaining = total - baseCount * groupValue;

  if (baseCount > 0) counts.fill(baseCount);
  distributeBalancedRemainder(counts, denominations, remaining);
  return counts;
}

function distributeBalancedRemainder(counts, denominations, amount) {
  let remaining = amount;
  let iterations = 0;
  const maxBalancedSteps = 2000;

  while (remaining > 0 && iterations < maxBalancedSteps) {
    const index = findLeastFilledDenominationIndex(counts, denominations, remaining);
    if (index === -1) break;
    counts[index] += 1;
    remaining -= denominations[index];
    iterations += 1;
  }

  if (remaining <= 0) return;

  denominations.forEach((denomination, index) => {
    if (remaining <= 0) return;
    const extra = Math.floor(remaining / denomination);
    if (!extra) return;
    counts[index] += extra;
    remaining -= extra * denomination;
  });

  if (remaining > 0) {
    counts[counts.length - 1] += Math.ceil(remaining / denominations[denominations.length - 1]);
  }
}

function findLeastFilledDenominationIndex(counts, denominations, amount) {
  let selectedIndex = -1;
  denominations.forEach((denomination, index) => {
    if (denomination > amount) return;
    if (selectedIndex === -1 || counts[index] < counts[selectedIndex]) selectedIndex = index;
  });
  return selectedIndex;
}

function capChipPlan(plan, maxVisibleChips) {
  const limit = Math.max(1, Math.floor(Number(maxVisibleChips) || 1));
  const totalVisible = plan.reduce((sum, entry) => sum + entry.count, 0);
  if (totalVisible <= limit) return plan;

  const capped = plan.map((entry) => ({
    denomination: entry.denomination,
    count: entry.count > 0 ? 1 : 0,
    sourceCount: entry.count,
  }));
  let slotsLeft = Math.max(0, limit - capped.reduce((sum, entry) => sum + entry.count, 0));

  while (slotsLeft > 0) {
    let selected = null;
    capped.forEach((entry) => {
      if (entry.sourceCount <= entry.count) return;
      if (!selected || entry.sourceCount - entry.count > selected.sourceCount - selected.count) selected = entry;
    });
    if (!selected) break;
    selected.count += 1;
    slotsLeft -= 1;
  }

  return capped.map(({ denomination, count }) => ({ denomination, count }));
}

function getChipDenominations(config = {}) {
  const options = Array.isArray(config.betOptions) ? config.betOptions : [];
  const normalized = options
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
  const defaults = normalized.length ? normalized : [5, 10, 20, 50];
  return Array.from(new Set(defaults)).sort((a, b) => b - a).slice(0, 4);
}

function createChipFaceTexture(denomination, palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const face = `#${palette.face.toString(16).padStart(6, '0')}`;
  const edge = `#${palette.edge.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = palette.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 30px Georgia';
  ctx.fillText(formatCompactAmount(denomination), 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function formatCompactAmount(value) {
  const amount = Math.floor(Number(value) || 0);
  if (amount >= 100000000) return `${Math.round(amount / 10000000) / 10}亿`;
  if (amount >= 10000) return `${Math.round(amount / 1000) / 10}万`;
  return amount.toLocaleString('zh-CN');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function lerp(from, to, value) {
  return from + (to - from) * value;
}

window.SFGTableScene3D = { createTableScene3D, applyBoardGameWoodTableMaterials };
window.dispatchEvent(new CustomEvent('sfg-table-scene-ready'));

import * as THREE from './vendor/three.module.min.js';

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
const DEFAULT_CAMERA_PITCH = 0.62;
const DEFAULT_CAMERA_DISTANCE = 8.9;
const DEFAULT_CAMERA_TARGET_Y = 0.04;
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

function createTableScene3D(container) {
  return new TableScene3D(container);
}

class TableScene3D {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.playersGroup = new THREE.Group();
    this.cardsGroup = new THREE.Group();
    this.potGroup = new THREE.Group();
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'table-scene-label-layer';
    this.labelsById = new Map();
    this.cardMeshes = [];
    this.materialsByDenomination = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.yaw = -0.42;
    this.pitch = DEFAULT_CAMERA_PITCH;
    this.distance = DEFAULT_CAMERA_DISTANCE;
    this.cameraSeatKey = '';
    this.lastHandId = '';
    this.lastSettlementAt = 0;
    this.potCollectAnimation = null;
    this.dealStartedAt = 0;
    this.disposed = false;
    this.drag = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
    this.bindEvents();
    this.resize();
    this.renderFrame = this.renderFrame.bind(this);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    requestAnimationFrame(this.renderFrame);
  }

  installScene() {
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

    this.deck = this.createCardMesh(null, true);
    this.deck.position.set(0, 0.3, -0.18);
    this.deck.rotation.x = -Math.PI / 2;
    this.deck.rotation.z = -0.12;
    this.deck.scale.set(1.08, 1.08, 1.08);
    this.scene.add(this.deck);

    this.scene.add(this.playersGroup);
    this.scene.add(this.cardsGroup);
    this.scene.add(this.potGroup);
  }

  bindEvents() {
    this.onPointerDown = (event) => {
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        yaw: this.yaw,
        pitch: this.pitch,
        moved: false,
      };
      this.container.setPointerCapture?.(event.pointerId);
    };

    this.onPointerMove = (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 7) this.drag.moved = true;
      this.yaw = this.drag.yaw - dx * 0.008;
      this.pitch = clamp(this.drag.pitch + dy * 0.006, 0.44, 1.18);
    };

    this.onPointerUp = (event) => {
      const shouldClick = this.drag && !this.drag.moved;
      this.drag = null;
      this.container.releasePointerCapture?.(event.pointerId);
      if (shouldClick) this.handleSceneClick(event);
    };

    this.onWheel = (event) => {
      event.preventDefault();
      this.distance = clamp(this.distance + event.deltaY * 0.006, 5.8, 10.4);
    };

    this.container.addEventListener('pointerdown', this.onPointerDown);
    this.container.addEventListener('pointermove', this.onPointerMove);
    this.container.addEventListener('pointerup', this.onPointerUp);
    this.container.addEventListener('pointercancel', this.onPointerUp);
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
  }

  update(snapshot = {}) {
    if (!snapshot.room) {
      this.clearPlayers();
      this.clearCards();
      this.clearPot();
      return;
    }

    const hand = snapshot.hand || {};
    if (hand.id && hand.id !== this.lastHandId) {
      this.lastHandId = hand.id;
      this.dealStartedAt = performance.now();
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const config = snapshot.room.config || {};
    this.alignCameraToViewerSeat(players, snapshot.viewerId);
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
    this.renderCards(players, hand, snapshot.viewerId);
  }

  renderPlayers(players, hand, viewerId, config) {
    this.clearPlayers();
    const activeIds = new Set(hand.activePlayerIds || []);
    const foldedIds = new Set(hand.foldedPlayerIds || []);
    const viewedIds = new Set(hand.viewedPlayerIds || []);

    players.forEach((player, index) => {
      const seat = seatPosition(index, players.length, LABEL_RADIUS, 0.86);
      const tableSeat = seatPosition(index, players.length, 2.64, 0.76);
      const chipDirection = new THREE.Vector3(tableSeat.x, 0, tableSeat.z).normalize();
      const chipTangent = new THREE.Vector3(-chipDirection.z, 0, chipDirection.x);
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

      const chips = this.createChipStack(player.coins, config, PLAYER_CHIP_LIMIT, 7);
      chips.position
        .set(tableSeat.x, 0.22, tableSeat.z)
        .addScaledVector(chipDirection, -0.28)
        .addScaledVector(chipTangent, 0.36);
      chips.rotation.y = -seat.angle;
      this.playersGroup.add(chips);

      const label = this.getLabel(player.id);
      label.className = 'table-seat-label';
      label.classList.toggle('is-me', player.id === viewerId);
      label.classList.toggle('is-turn', player.id === hand.currentTurnPlayerId);
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
    chips.position.set(0.62, 0.31, -0.12);
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
    const frontTexture = createCardTexture(card, isBack);
    const backTexture = createCardTexture(null, true);
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
      disposeMaterial(mesh.material);
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

  renderFrame(now) {
    if (this.disposed) return;
    this.updateCamera();
    this.animateCards(now);
    this.animatePotCollect(now);
    this.renderer.render(this.scene, this.camera);
    this.positionLabels();
    requestAnimationFrame(this.renderFrame);
  }

  updateCamera() {
    const radius = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      Math.sin(this.yaw) * radius,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * radius
    );
    this.camera.lookAt(this.rayTarget);
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
        chip.castShadow = true;
        chip.receiveShadow = true;
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
    this.labelsById.forEach((label) => {
      if (label.hidden || !label.__worldPosition) return;
      const projected = label.__worldPosition.clone().project(this.camera);
      const labelWidth = label.offsetWidth || 140;
      const labelHeight = label.offsetHeight || 52;
      const x = clamp((projected.x * 0.5 + 0.5) * rect.width, labelWidth / 2 + 6, rect.width - labelWidth / 2 - 6);
      const y = clamp((-projected.y * 0.5 + 0.5) * rect.height, labelHeight / 2 + 6, rect.height - labelHeight / 2 - 6);
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
  return texture;
}

function disposeMaterial(material) {
  const materials = Array.isArray(material) ? material : [material];
  const disposed = new Set();
  materials.forEach((item) => {
    if (!item || disposed.has(item)) return;
    item.map?.dispose();
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

window.SFGTableScene3D = { createTableScene3D };
window.dispatchEvent(new CustomEvent('sfg-table-scene-ready'));

import * as THREE from './vendor/three.module.min.js';

const SUITS = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const RED_SUITS = new Set(['H', 'D']);
const CARD_SIZE = { width: 0.42, height: 0.62 };
const TABLE_RADIUS = 3.05;
const LABEL_RADIUS = 4.15;

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
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'table-scene-label-layer';
    this.labelsById = new Map();
    this.cardMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.yaw = -0.42;
    this.pitch = 0.88;
    this.distance = 7.9;
    this.lastHandId = '';
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
    this.rayTarget = new THREE.Vector3(0, 0.2, 0);

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
      return;
    }

    const hand = snapshot.hand || {};
    if (hand.id && hand.id !== this.lastHandId) {
      this.lastHandId = hand.id;
      this.dealStartedAt = performance.now();
    }

    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    this.renderPlayers(players, hand, snapshot.viewerId);
    this.renderCards(players, hand, snapshot.viewerId);
  }

  renderPlayers(players, hand, viewerId) {
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

      const chips = createChipStack(player.coins);
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
      label.querySelector('span').textContent = playerStatus(player, hand);
      label.hidden = false;
    });

    this.labelsById.forEach((label, id) => {
      if (!players.some((player) => player.id === id)) label.hidden = true;
    });
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
        const spread = (cardIndex - 1) * 0.36;
        const basePosition = new THREE.Vector3(base.x, 0.42, base.z).addScaledVector(tangent, spread);
        const angle = Math.atan2(dir.x, dir.z);

        if (folded) {
          mesh.position.copy(basePosition).addScaledVector(dir, -0.1);
          mesh.rotation.set(-Math.PI / 2, 0, angle + (cardIndex - 1) * 0.2);
          mesh.material.opacity = 0.55;
        } else if (viewed) {
          mesh.position.copy(basePosition).addScaledVector(dir, -0.1);
          mesh.position.y = 0.78;
          mesh.lookAt(0, 0.64, 0);
          mesh.rotateZ((cardIndex - 1) * -0.08);
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
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.cardsGroup.add(mesh);
        this.cardMeshes.push(mesh);
      }
    });
  }

  createCardMesh(card, isBack) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 376;
    const ctx = canvas.getContext('2d');
    drawCard(ctx, canvas.width, canvas.height, card, isBack);
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.62,
      metalness: 0.02,
      side: THREE.DoubleSide,
      transparent: true,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(CARD_SIZE.width, CARD_SIZE.height), material);
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

  clearCards() {
    this.cardMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
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
    this.renderer.dispose();
  }
}

function drawCard(ctx, width, height, card, isBack) {
  roundRect(ctx, 10, 10, width - 20, height - 20, 28);
  ctx.fillStyle = isBack ? '#123742' : '#fff9eb';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = isBack ? '#f5d77d' : '#d1a954';
  ctx.stroke();

  if (isBack) {
    ctx.fillStyle = '#0b252d';
    roundRect(ctx, 34, 34, width - 68, height - 68, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 215, 125, 0.62)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#f5d77d';
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
  ctx.font = '900 44px Georgia';
  ctx.fillText(rank, 45, 64);
  ctx.font = '900 38px Georgia';
  ctx.fillText(suit, 45, 106);
  ctx.save();
  ctx.translate(width - 45, height - 48);
  ctx.rotate(Math.PI);
  ctx.font = '900 44px Georgia';
  ctx.fillText(rank, 0, 0);
  ctx.font = '900 38px Georgia';
  ctx.fillText(suit, 0, 42);
  ctx.restore();

  ctx.font = '900 118px Georgia';
  ctx.fillText(suit, width / 2, height / 2 + 46);
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

function createChipStack(coins) {
  const group = new THREE.Group();
  const amount = Math.max(0, Number(coins) || 0);
  const stackCount = amount >= 1000 ? 3 : amount >= 200 ? 2 : 1;
  const baseChips = Math.max(4, Math.min(10, Math.round(Math.log10(amount + 10) * 2.2)));
  const colors = [
    { face: 0xf2d46d, edge: 0x7d5b15, stripe: 0xfff3ae },
    { face: 0x2fbf9c, edge: 0x0d5b4c, stripe: 0xbdf6e7 },
    { face: 0xb84b55, edge: 0x63242c, stripe: 0xffc1c7 },
  ];

  for (let stack = 0; stack < stackCount; stack += 1) {
    const chipsInStack = Math.max(2, baseChips - stack);
    const stackOffset = (stack - (stackCount - 1) / 2) * 0.16;
    for (let index = 0; index < chipsInStack; index += 1) {
      const palette = colors[(stack + index) % colors.length];
      const chip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.085, 0.024, 32),
        new THREE.MeshStandardMaterial({
          color: palette.face,
          roughness: 0.34,
          metalness: 0.28,
        })
      );
      chip.position.set(stackOffset + Math.sin(index) * 0.006, index * 0.027, stack * 0.055 + Math.cos(index) * 0.004);
      chip.castShadow = true;
      chip.receiveShadow = true;
      group.add(chip);

      const edge = new THREE.Mesh(
        new THREE.TorusGeometry(0.086, 0.006, 6, 32),
        new THREE.MeshStandardMaterial({
          color: palette.edge,
          roughness: 0.28,
          metalness: 0.32,
        })
      );
      edge.position.copy(chip.position);
      edge.position.y += 0.013;
      edge.rotation.x = Math.PI / 2;
      group.add(edge);

      const innerRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.052, 0.004, 6, 28),
        new THREE.MeshStandardMaterial({
          color: palette.stripe,
          roughness: 0.3,
          metalness: 0.2,
        })
      );
      innerRing.position.copy(edge.position);
      innerRing.position.y += 0.001;
      innerRing.rotation.x = Math.PI / 2;
      group.add(innerRing);

      for (let stripeIndex = 0; stripeIndex < 4; stripeIndex += 1) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(0.028, 0.004, 0.008),
          new THREE.MeshStandardMaterial({
            color: palette.stripe,
            roughness: 0.3,
            metalness: 0.2,
          })
        );
        const angle = (Math.PI / 2) * stripeIndex;
        stripe.position.set(
          chip.position.x + Math.cos(angle) * 0.073,
          chip.position.y + 0.026,
          chip.position.z + Math.sin(angle) * 0.073
        );
        stripe.rotation.y = -angle;
        group.add(stripe);
      }
    }
  }

  const highlight = new THREE.Mesh(
    new THREE.CircleGeometry(0.19, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    })
  );
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.set(-0.05, 0.29, -0.03);
  group.add(highlight);

  return group;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

window.SFGTableScene3D = { createTableScene3D };
window.dispatchEvent(new CustomEvent('sfg-table-scene-ready'));

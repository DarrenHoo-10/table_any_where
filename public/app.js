const DEFAULT_ROOM_CONFIG = {
  mode: 'zha_jing_hua',
  initialCoins: 1000,
  baseBet: 5,
  bonus: 50,
  betOptions: [5, 10, 20, 50],
  actionTimeoutSeconds: 180,
};

const TABLE_THEME_KEYS = new Set(['classic', 'red_wood_tray']);

const ZODIAC_AVATARS = [
  { key: 'rat', label: '鼠', legacy: '🐭' },
  { key: 'ox', label: '牛', legacy: '🐮' },
  { key: 'tiger', label: '虎', legacy: '🐯' },
  { key: 'rabbit', label: '兔', legacy: '🐰' },
  { key: 'dragon', label: '龙', legacy: '🐲' },
  { key: 'snake', label: '蛇', legacy: '🐍' },
  { key: 'horse', label: '马', legacy: '🐴' },
  { key: 'goat', label: '羊', legacy: '🐐' },
  { key: 'monkey', label: '猴', legacy: '🐵' },
  { key: 'rooster', label: '鸡', legacy: '🐔' },
  { key: 'dog', label: '狗', legacy: '🐶' },
  { key: 'pig', label: '猪', legacy: '🐷' },
];

const MODE_LABELS = {
  zha_jing_hua: 'Flush',
  tractor: 'Straight',
};

const MODE_RULES = {
  zha_jing_hua: {
    title: 'Flush 模式',
    short: '同花比顺子大，豹子仍是最大牌型。',
    summary: 'Flush 模式更看重同花牌型：同花高于顺子，适合偏传统炸金花的节奏。',
    ranking: '牌型从小到大：普通牌、对子、顺子、同花、同花顺、豹子。',
  },
  tractor: {
    title: 'Straight 模式',
    short: '顺子为核心大牌，顺子高于同花和同花顺。',
    summary: 'Straight 模式更看重连续牌：顺子压过同花和同花顺，牌局判断会更偏向顺子价值。',
    ranking: '牌型从小到大：普通牌、对子、同花、同花顺、顺子、豹子。',
  },
};

const SUITS = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

const RED_SUITS = { H: true, D: true };

const state = {
  ws: null,
  connected: false,
  room: null,
  playerId: '',
  playerToken: '',
  roomId: '',
  nickname: localStorage.getItem('nickname') || randomNickname(),
  avatarUrl: normalizeAvatarKey(localStorage.getItem('avatarUrl')),
  lastSession: loadJson('lastRoomSession'),
  status: '未连接',
  peekedCards: null,
  peekTargetModalOpen: false,
  peekResultModalOpen: false,
  peekResultTimer: null,
  leavingRoom: false,
  avatarModalOpen: false,
  roomPanelCollapsed: false,
  rotateHintDismissed: localStorage.getItem('rotateHintDismissed') === 'true',
  tableScene3d: null,
  roomCopyHintTimer: null,
};

const $ = (id) => document.getElementById(id);

const els = {};
[
  'app',
  'nicknameInput',
  'avatarPicker',
  'createRoomBtn',
  'joinRoomBtn',
  'roomCodeInput',
  'statusText',
  'connectionBadge',
  'lobbyView',
  'tableView',
  'finalView',
  'roomPanel',
  'roomPanelToggleBtn',
  'roomCodeText',
  'dismissRotateHintBtn',
  'openAvatarBtn',
  'avatarModal',
  'closeAvatarModalBtn',
  'peekTargetModal',
  'peekTargetOptions',
  'closePeekTargetModalBtn',
  'peekResultModal',
  'peekResultBody',
  'confirmPeekResultBtn',
  'playerList',
  'startHandBtn',
  'leaveRoomBtn',
  'potText',
  'currentTurnText',
  'tableScene3d',
  'tableTurnTimer',
  'myCards',
  'peekedCards',
  'actions',
  'settlementPanel',
  'continueHandBtn',
  'finishGameBtn',
  'rankingList',
  'backHomeBtn',
  'modeSelect',
  'modeHelpBtn',
  'modeRulesPreview',
  'roomRulesBrief',
  'initialCoinsInput',
  'baseBetInput',
  'bonusInput',
  'betOptionsInput',
  'actionTimeoutInput',
].forEach((id) => {
  els[id] = $(id);
});

init();

window.addEventListener('sfg-table-scene-ready', () => {
  if (!state.room) return;
  renderTableScene3d();
});

window.addEventListener('sfg-table-card-click', (event) => {
  const playerId = event.detail && event.detail.playerId;
  handleTableCardClick(playerId);
});

function init() {
  applyVisualConfig();
  if (els.nicknameInput) els.nicknameInput.value = state.nickname;
  applyDefaultConfig();
  bindEvents();
  connect();
  setInterval(renderTurnClock, 1000);
  render();
}

function bindEvents() {
  els.nicknameInput.addEventListener('input', () => {
    state.nickname = els.nicknameInput.value.trim().slice(0, 16) || randomNickname();
    localStorage.setItem('nickname', state.nickname);
  });

  els.modeSelect.addEventListener('change', () => {
    renderModeRulePreview();
    highlightLobbyModeCard(els.modeSelect.value);
  });

  els.modeHelpBtn.addEventListener('click', () => {
    const expanded = els.modeRulesPreview.hidden;
    els.modeRulesPreview.hidden = !expanded;
    els.modeHelpBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    highlightLobbyModeCard(els.modeSelect.value);
  });

  els.avatarPicker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-avatar]');
    if (!button || button.disabled) return;
    if (state.room) send('select_avatar', { avatarUrl: button.dataset.avatar });
  });

  els.createRoomBtn.addEventListener('click', () => {
    beginNewRoomRequest('正在创建房间...');
    render();
    send('create_room', {
      player: playerPayload(),
      config: readRoomConfig(),
    });
  });

  els.joinRoomBtn.addEventListener('click', () => {
    const roomId = els.roomCodeInput.value.trim().toUpperCase();
    if (!roomId) {
      toast('请输入房间号');
      return;
    }
    beginNewRoomRequest('正在加入房间...');
    render();
    send('join_room', { roomId, player: playerPayload() });
  });

  els.roomPanel.addEventListener('click', copyRoomId);
  els.roomPanel.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (state.roomPanelCollapsed) {
      toggleRoomPanel();
      return;
    }
    copyRoomId();
  });
  els.roomPanelToggleBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleRoomPanel();
  });
  els.roomPanelToggleBtn.addEventListener('keydown', (event) => {
    event.stopPropagation();
  });
  els.dismissRotateHintBtn.addEventListener('click', () => {
    state.rotateHintDismissed = true;
    localStorage.setItem('rotateHintDismissed', 'true');
    renderRotateHint();
  });

  els.openAvatarBtn.addEventListener('click', () => {
    state.avatarModalOpen = true;
    render();
  });
  els.closeAvatarModalBtn.addEventListener('click', () => {
    if (!currentPlayerHasAvatar()) {
      toast('请先选择头像');
      state.avatarModalOpen = true;
      render();
      return;
    }
    state.avatarModalOpen = false;
    render();
  });
  els.closePeekTargetModalBtn.addEventListener('click', () => {
    state.peekTargetModalOpen = false;
    render();
  });
  els.confirmPeekResultBtn.addEventListener('click', closePeekResultModal);
  els.startHandBtn.addEventListener('click', () => send('start_hand'));
  els.continueHandBtn.addEventListener('click', () => send('start_hand'));
  els.finishGameBtn.addEventListener('click', () => send('finish_game'));
  els.leaveRoomBtn.addEventListener('click', leaveRoom);
  els.backHomeBtn.addEventListener('click', () => {
    clearRoomSession('已返回首页');
    render();
  });
}

function connect() {
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}`;
  state.ws = new WebSocket(url);
  state.status = `连接中 ${url}`;

  state.ws.addEventListener('open', () => {
    state.connected = true;
    state.status = '已连接';
    if (state.lastSession && state.lastSession.roomId && !state.room) {
      send('reconnect', state.lastSession);
    }
    render();
  });

  state.ws.addEventListener('close', () => {
    state.connected = false;
    state.status = '连接已断开，正在重连...';
    render();
    setTimeout(connect, 1200);
  });

  state.ws.addEventListener('error', () => {
    state.connected = false;
    state.status = '连接失败';
    render();
  });

  state.ws.addEventListener('message', (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (error) {
      toast('服务器消息格式错误');
    }
  });
}

function handleMessage(message) {
  const payload = message.payload || {};

  if (message.type === 'welcome') {
    state.leavingRoom = false;
    state.roomPanelCollapsed = false;
    state.roomId = payload.roomId;
    state.playerId = payload.playerId;
    state.playerToken = payload.playerToken;
    state.lastSession = payload;
    state.status = '已进入房间';
    localStorage.setItem('lastRoomSession', JSON.stringify(payload));
  }

  if (message.type === 'room_state') {
    if (state.leavingRoom) return;
    if (!shouldAcceptRoomState(payload)) return;
    state.room = normalizeRoom(payload);
    state.roomId = state.room.id;
    syncSelectedAvatar();
    syncAvatarModalState();
    if (!state.room.hand) {
      state.peekedCards = null;
      state.peekTargetModalOpen = false;
      closePeekResultModal({ renderAfterClose: false });
    }
    if (state.room.finalSettlement) state.status = '游戏已结算';
  }

  if (message.type === 'hand_state' && state.room) {
    state.room.hand = normalizeHand(payload.hand || payload);
  }

  if (message.type === 'private_cards') {
    if (payload.participantHands) {
      state.peekedCards = payload;
      state.peekResultModalOpen = true;
      if (state.room && state.room.hand && payload.participantHands[state.playerId]) {
        state.room.hand.myCards = payload.participantHands[state.playerId];
      }
      state.status = '照牌结果已揭晓';
      schedulePeekResultAutoClose();
    } else if (payload.targetPlayerId === state.playerId) {
      if (state.room && state.room.hand) state.room.hand.myCards = payload.cards;
      state.status = '已看自己的牌';
    } else {
      state.peekedCards = payload;
      state.status = '已照对手牌';
    }
  }

  if (message.type === 'action_result') {
    applyCoinSnapshot(payload);
    state.status = describeAction(payload);
    if (['bet', 'showdown'].includes(payload.action)) animateChipThrow(payload);
  }

  if (message.type === 'hand_settlement' && state.room) {
    applySettlementCoins(payload);
    state.room.lastSettlement = payload;
    state.peekedCards = null;
    state.peekTargetModalOpen = false;
    closePeekResultModal({ renderAfterClose: false });
    state.status = '本手结算完成';
  }

  if (message.type === 'final_settlement') {
    if (!state.room) state.room = {};
    state.room.finalSettlement = payload;
    state.room.status = 'finished';
    state.status = '最终结算';
  }

  if (message.type === 'left_room') {
    clearRoomSession('已离开房间');
  }

  if (message.type === 'error') {
    state.status = payload.message || '操作失败';
    toast(state.status);
  }

  render();
}

function send(type, payload = {}) {
  connect();
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    toast('连接还没准备好，请稍后再试');
    return false;
  }
  state.ws.send(JSON.stringify({ type, payload }));
  return true;
}

function render() {
  renderStatus();
  renderModeRulePreview();
  renderViews();
  renderRotateHint();
  if (!state.room) {
    renderTableScene3d();
    return;
  }
  renderRoom();
  renderRoomRules();
  renderAvatarPicker();
  renderAvatarModal();
  renderPeekTargetModal();
  renderPeekResultModal();
  renderPlayers();
  renderHand();
  renderSettlement();
  renderFinal();
}

function renderStatus() {
  els.statusText.textContent = state.status;
  els.connectionBadge.textContent = state.connected ? '在线' : '离线';
  els.connectionBadge.classList.toggle('is-online', state.connected);
}

function renderViews() {
  const hasRoom = Boolean(state.room);
  const isFinished = hasRoom && state.room.status === 'finished' && state.room.finalSettlement;
  els.lobbyView.hidden = hasRoom;
  els.tableView.hidden = !hasRoom || isFinished;
  els.finalView.hidden = !isFinished;
  document.body.classList.toggle('is-in-room', hasRoom);
}

function renderRoom() {
  els.roomCodeText.textContent = state.room.id || '-';
  const config = state.room.config || DEFAULT_ROOM_CONFIG;
  const timeoutMinutes = Math.round((config.actionTimeoutSeconds || DEFAULT_ROOM_CONFIG.actionTimeoutSeconds) / 60);
  const summary = `${MODE_LABELS[config.mode] || config.mode} · 初始 ${formatCoins(config.initialCoins || DEFAULT_ROOM_CONFIG.initialCoins)} · 底注 ${config.baseBet} · 喜钱 ${config.bonus} · ${timeoutMinutes}分钟行动`;
  const roomMeta = document.querySelector('[data-room-meta]');
  if (roomMeta) roomMeta.textContent = summary;
  els.roomPanel.classList.toggle('is-collapsed', state.roomPanelCollapsed);
  els.roomPanel.setAttribute('aria-label', state.roomPanelCollapsed ? '展开房间信息' : '点击复制房间号');
  els.roomPanelToggleBtn.setAttribute('aria-expanded', state.roomPanelCollapsed ? 'false' : 'true');
  els.roomPanelToggleBtn.setAttribute('aria-label', state.roomPanelCollapsed ? '展开房间信息' : '折叠房间信息');
  els.roomPanelToggleBtn.textContent = state.roomPanelCollapsed ? '+' : '-';
}

function renderRotateHint() {
  const hint = document.querySelector('.rotate-phone-hint');
  if (!hint) return;
  hint.hidden = state.rotateHintDismissed || !state.room;
}

function toggleRoomPanel() {
  state.roomPanelCollapsed = !state.roomPanelCollapsed;
  renderRoom();
}

async function copyRoomId() {
  if (!state.room) return;
  if (state.roomPanelCollapsed) {
    toggleRoomPanel();
    return;
  }
  const result = await copyTextToClipboard(state.room.id);
  if (result === 'copied') {
    setRoomCopyHint('✓ 已复制', 'copied');
    toast('房间号已复制');
  } else if (result === 'manual') {
    setRoomCopyHint('✓ 已选中', 'copied');
    toast('房间号已选中，请按复制');
  } else {
    setRoomCopyHint('复制失败', 'failed');
    toast(`复制失败，房间号：${state.room.id}`);
  }
}

function setRoomCopyHint(text, tone) {
  const hint = document.querySelector('.room-copy-hint');
  if (!hint) return;
  if (state.roomCopyHintTimer) clearTimeout(state.roomCopyHintTimer);
  hint.textContent = text;
  hint.classList.toggle('is-copied', tone === 'copied');
  hint.classList.toggle('is-failed', tone === 'failed');
  state.roomCopyHintTimer = setTimeout(() => {
    hint.textContent = '点击复制';
    hint.classList.remove('is-copied', 'is-failed');
  }, 1800);
}

function renderModeRulePreview() {
  if (!els.modeSelect || !els.modeRulesPreview) return;
  const rules = getModeRules(els.modeSelect.value);
  const title = els.modeRulesPreview.querySelector('[data-mode-rule-title]');
  const copy = els.modeRulesPreview.querySelector('[data-mode-rule-copy]');
  if (title) title.textContent = rules.title;
  if (copy) copy.textContent = `${rules.short} ${rules.ranking}`;
}

function highlightLobbyModeCard(mode) {
  document.querySelectorAll('[data-mode-card]').forEach((card) => {
    card.classList.toggle('is-active', card.dataset.modeCard === mode);
  });
}

function renderRoomRules() {
  if (!els.roomRulesBrief || !state.room) return;
  const config = state.room.config || DEFAULT_ROOM_CONFIG;
  const rules = getModeRules(config.mode);
  const title = els.roomRulesBrief.querySelector('[data-room-rule-title]');
  const summary = els.roomRulesBrief.querySelector('[data-room-rule-summary]');
  const points = els.roomRulesBrief.querySelector('[data-room-rule-points]');
  const timeoutMinutes = Math.round((config.actionTimeoutSeconds || DEFAULT_ROOM_CONFIG.actionTimeoutSeconds) / 60);
  const betOptions = (Array.isArray(config.betOptions) && config.betOptions.length ? config.betOptions : DEFAULT_ROOM_CONFIG.betOptions).join('/');
  const pointTexts = [
    rules.ranking,
    `每手开始所有玩家先扣底注 ${formatCoins(config.baseBet)}，奖池由下注、照牌、开牌费用累积。`,
    `看牌后仍可下注；照牌每手一次，只能照已经看过自己牌且未弃牌的玩家，输家直接出局。`,
    `只剩两名玩家时可以开牌；豹子触发喜钱 ${formatCoins(config.bonus)}，玩家金币小于等于0时只给该玩家补回初始金额。`,
    `本房间下注档为 ${betOptions}，行动时间为 ${timeoutMinutes} 分钟。`,
  ];

  if (title) title.textContent = rules.title;
  if (summary) summary.textContent = rules.summary;
  if (points) {
    points.innerHTML = '';
    pointTexts.forEach((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      points.appendChild(item);
    });
  }
}

function renderPlayers() {
  const players = (state.room.players || []).slice().sort((a, b) => (a.seat || 0) - (b.seat || 0));
  const hand = safeHand();
  els.playerList.innerHTML = '';

  players.forEach((player) => {
    const item = document.createElement('li');
    item.className = 'player-card';
    if (player.id === state.playerId) item.classList.add('is-me');
    if (hand.currentTurnPlayerId === player.id) item.classList.add('is-turn');

    const tags = [`顺序 ${player.seat}`];
    if (player.isHost) tags.push('房主');
    if (player.connected === false) tags.push('离线');
    if (!normalizeAvatarKey(player.avatarUrl)) tags.push('待选头像');
    if (state.room.hand && !(hand.activePlayerIds || []).includes(player.id) && !(hand.foldedPlayerIds || []).includes(player.id)) {
      tags.push('等待下手');
    }
    if ((hand.foldedPlayerIds || []).includes(player.id)) tags.push('弃牌');
    if ((hand.viewedPlayerIds || []).includes(player.id)) tags.push('已看');
    if (hand.currentTurnPlayerId === player.id) tags.push('行动');

    item.innerHTML = `
      <div class="player-main">
        <span class="player-avatar" aria-hidden="true">${avatarMarkup(player.avatarUrl)}</span>
        <div>
          <strong>${escapeHtml(player.nickname)}</strong>
          <span>${tags.join(' ')}</span>
        </div>
      </div>
      <b>${formatCoins(player.coins)}</b>
    `;
    els.playerList.appendChild(item);
  });

  const host = isHost();
  const allAvatarsSelected = players.every((player) => normalizeAvatarKey(player.avatarUrl));
  els.startHandBtn.hidden = !host || state.room.status !== 'lobby';
  els.startHandBtn.disabled = !host || players.length < 1 || state.room.status !== 'lobby' || !allAvatarsSelected;
  els.startHandBtn.title = !allAvatarsSelected ? '所有玩家选择头像后才能开始发牌。' : '';
  els.continueHandBtn.hidden = !host || state.room.status !== 'between_hands';
  els.continueHandBtn.disabled = !host || state.room.status !== 'between_hands' || !allAvatarsSelected;
  els.continueHandBtn.title = !allAvatarsSelected ? '所有玩家选择头像后才能继续发牌。' : '';
  els.finishGameBtn.hidden = !host;
  els.finishGameBtn.disabled = !host || state.room.status === 'playing';
}

function renderHand() {
  const hand = safeHand();
  els.potText.textContent = formatCoins(hand.pot || 0);
  renderCurrentTurnText(hand);
  renderTableScene3d(hand);
  renderCards(els.myCards, hand.myCards);
  renderTableTurnTimer(hand);
  renderPeekedCards();
  renderActions();
}

function renderCurrentTurnText(hand = safeHand()) {
  const current = findPlayer(hand.currentTurnPlayerId);
  const timer = formatTurnTimer(hand.turnDeadlineAt);
  els.currentTurnText.textContent = current ? `${current.nickname}${timer ? ` · ${timer}` : ''}` : '-';
}

function renderTableTurnTimer(hand = safeHand()) {
  if (!els.tableTurnTimer) return;
  const timer = formatTurnTimer(hand.turnDeadlineAt);
  const visible = Boolean(state.room && state.room.hand && hand.currentTurnPlayerId && timer);
  const isWarning = visible && getTurnRemainingSeconds(hand.turnDeadlineAt) <= 15;
  if (state.tableScene3d && typeof state.tableScene3d.updateTurnTimer === 'function') {
    state.tableScene3d.updateTurnTimer(timer, isWarning, visible);
  }
  els.tableTurnTimer.hidden = !visible;
  if (!visible) {
    els.tableTurnTimer.innerHTML = '';
    return;
  }
  els.tableTurnTimer.classList.toggle('is-warning', isWarning);
  els.tableTurnTimer.innerHTML = `
    <strong>${timer}</strong>
  `;
}

function renderTableScene3d(hand = safeHand()) {
  if (!els.tableScene3d) return;
  const api = window.SFGTableScene3D;
  if (!api) return;
  if (!state.room) {
    if (state.tableScene3d) state.tableScene3d.update({ room: null });
    return;
  }
  if (!state.tableScene3d) {
    state.tableScene3d = api.createTableScene3D(els.tableScene3d, {
      tableTheme: getTableTheme(),
    });
  }

  const players = (state.room.players || [])
    .slice()
    .sort((a, b) => (a.seat || 0) - (b.seat || 0))
    .map((player) => {
      const avatar = getAvatarInfo(player.avatarUrl);
      return Object.assign({}, player, {
        avatarLabel: avatar ? avatar.label : '待选头像',
        avatarSrc: avatar ? `/avatars/${avatar.key}.png` : '/avatars/.png',
      });
    });

  state.tableScene3d.update({
    room: state.room,
    players,
    hand,
    viewerId: state.playerId,
  });
}

function applyVisualConfig() {
  document.body.dataset.tableTheme = getTableTheme();
}

function getTableTheme() {
  const configuredTheme = window.SFG_CONFIG
    && window.SFG_CONFIG.visual
    && window.SFG_CONFIG.visual.tableTheme;
  return TABLE_THEME_KEYS.has(configuredTheme) ? configuredTheme : 'classic';
}

function handleTableCardClick(playerId) {
  if (!playerId || !state.room || !state.room.hand) return;
  const hand = safeHand();
  const activeIds = hand.activePlayerIds || [];
  const viewedIds = hand.viewedPlayerIds || [];
  const peekUsedIds = hand.peekUsedPlayerIds || [];

  if (playerId === state.playerId) {
    if (activeIds.includes(playerId) && !viewedIds.includes(playerId)) {
      send('action', { type: 'view_self' });
    }
    return;
  }

  if (
    hand.currentTurnPlayerId === state.playerId &&
    activeIds.includes(state.playerId) &&
    activeIds.includes(playerId) &&
    viewedIds.includes(state.playerId) &&
    viewedIds.includes(playerId) &&
    !peekUsedIds.includes(state.playerId)
  ) {
    state.peekTargetModalOpen = true;
    render();
  }
}

function renderCards(container, cards) {
  container.innerHTML = '';
  for (let i = 0; i < 3; i += 1) {
    const card = cards && cards[i] ? cards[i] : null;
    const element = document.createElement('div');
    element.className = card ? `playing-card suit-${card.suit}` : 'playing-card is-back';
    if (card && RED_SUITS[card.suit]) element.classList.add('is-red');
    element.setAttribute('aria-label', card ? `${card.rank}${SUITS[card.suit] || card.suit}` : '暗牌');
    element.innerHTML = card ? cardFaceMarkup(card) : cardBackMarkup();
    container.appendChild(element);
  }
}

function cardFaceMarkup(card) {
  const rank = escapeHtml(card.rank);
  const suit = escapeHtml(SUITS[card.suit] || card.suit);
  return `
    <span class="card-corner card-corner-top">
      <span class="card-rank">${rank}</span>
      <span class="card-suit">${suit}</span>
    </span>
    <span class="card-center" aria-hidden="true">
      <span class="card-center-suit">${suit}</span>
      <span class="card-center-rank">${rank}</span>
    </span>
    <span class="card-corner card-corner-bottom">
      <span class="card-rank">${rank}</span>
      <span class="card-suit">${suit}</span>
    </span>
  `;
}

function cardBackMarkup() {
  return `
    <span class="card-back-emblem" aria-hidden="true">
      <span class="card-back-suit">♠</span>
      <span class="card-back-monogram">SFG</span>
    </span>
  `;
}

function renderPeekedCards() {
  els.peekedCards.innerHTML = '';
  if (!state.peekedCards) return;
  if (state.peekedCards.participantHands) {
    renderPeekResult();
    return;
  }
  const target = findPlayer(state.peekedCards.targetPlayerId);
  const title = document.createElement('p');
  title.textContent = `照牌：${target ? target.nickname : '对手'}`;
  els.peekedCards.appendChild(title);
  const row = document.createElement('div');
  row.className = 'card-row is-small';
  els.peekedCards.appendChild(row);
  renderCards(row, state.peekedCards.cards);
}

function renderPeekResult() {
  const requester = findPlayer(state.peekedCards.requesterId);
  const target = findPlayer(state.peekedCards.targetPlayerId);
  const winner = findPlayer(state.peekedCards.winnerId);
  const title = document.createElement('p');
  const leftName = requester ? requester.nickname : '发起方';
  const rightName = target ? target.nickname : '被照方';
  title.textContent = `照牌：${leftName} vs ${rightName} · 胜者 ${winner ? winner.nickname : '玩家'}`;
  els.peekedCards.appendChild(title);

  [state.peekedCards.requesterId, state.peekedCards.targetPlayerId].forEach((playerId) => {
    const cards = state.peekedCards.participantHands[playerId];
    if (!Array.isArray(cards)) return;
    const player = findPlayer(playerId);
    const item = document.createElement('article');
    item.className = 'peek-result-hand';
    const label = document.createElement('p');
    label.textContent = `${player ? player.nickname : '玩家'}${playerId === state.peekedCards.winnerId ? ' · 赢' : ' · 输'}`;
    const row = document.createElement('div');
    row.className = 'card-row is-small';
    item.appendChild(label);
    item.appendChild(row);
    els.peekedCards.appendChild(item);
    renderCards(row, cards);
  });
}

function renderActions() {
  const hand = safeHand();
  const activeIds = hand.activePlayerIds || [];
  const viewedIds = hand.viewedPlayerIds || [];
  const peekUsedIds = hand.peekUsedPlayerIds || [];
  const pendingPeekRequest = hand.pendingPeekRequest;
  const isActive = activeIds.includes(state.playerId);
  const isTurn = hand.currentTurnPlayerId === state.playerId;
  const hasViewed = viewedIds.includes(state.playerId);
  const options = (state.room.config && state.room.config.betOptions) || DEFAULT_ROOM_CONFIG.betOptions;
  const legalOptions = Array.isArray(hand.legalBetOptions) ? hand.legalBetOptions : [];
  const legalByAmount = new Map(legalOptions.map((option) => [option.amount, option]));
  const enabledBetOptions = legalOptions.filter((option) => !option.disabled);
  els.actions.innerHTML = '';

  if (!state.room.hand) {
    els.actions.appendChild(actionNote('等待本手开始'));
    return;
  }

  if (!isActive) {
    const foldedIds = hand.foldedPlayerIds || [];
    els.actions.appendChild(actionNote(foldedIds.includes(state.playerId) ? '你已弃牌，等待结算' : '你正在旁观，等待下一手'));
    return;
  }

  if (pendingPeekRequest) {
    renderPendingPeekActions(pendingPeekRequest);
    return;
  }

  if (!hasViewed) {
    els.actions.appendChild(actionButton('看牌', () => send('action', { type: 'view_self' }), 'secondary'));
  }

  if (!isTurn) {
    els.actions.appendChild(actionNote('等待其他玩家行动'));
    return;
  }

  options.slice(0, 4).forEach((amount) => {
    const option = legalByAmount.get(amount) || { amount, cost: amount, disabled: false };
    const button = actionButton(`下 ${amount}`, () => {
      send('action', { type: 'bet', amount });
    }, 'primary', option.disabled);
    if (option.reason) button.title = option.reason;
    els.actions.appendChild(button);
  });

  els.actions.appendChild(actionButton('弃牌', () => send('action', { type: 'fold' }), 'danger'));
  const peekTargets = findPeekTargets();
  if (activeIds.length > 2 && peekTargets.length) {
    const peekButton = actionButton('照牌', () => {
      state.peekTargetModalOpen = true;
      render();
    }, 'secondary', peekUsedIds.includes(state.playerId) || !enabledBetOptions.length || !hasViewed);
    if (!hasViewed) peekButton.title = '看牌后才可以照牌。';
    els.actions.appendChild(peekButton);
  } else {
    els.actions.appendChild(actionButton(peekUsedIds.includes(state.playerId) ? '已照牌' : '照牌', () => {}, 'secondary', true));
  }
  const isSoloShowdown = activeIds.length === 1;
  const defaultBet = isSoloShowdown ? 0 : enabledBetOptions[0] ? enabledBetOptions[0].amount : options[0];
  els.actions.appendChild(actionButton('开牌', () => {
    send('action', isSoloShowdown ? { type: 'showdown' } : { type: 'showdown', amount: defaultBet });
  }, 'primary', !hand.canShowdown || (!isSoloShowdown && !enabledBetOptions.length)));
  els.actions.lastChild.textContent = isSoloShowdown ? '开牌' : `开牌 ${defaultBet}`;
}

function renderPendingPeekActions(request) {
  const requester = findPlayer(request.requesterId);
  const target = findPlayer(request.targetPlayerId);
  if (request.targetPlayerId === state.playerId) {
    els.actions.appendChild(actionNote(`${requester ? requester.nickname : '玩家'} 请求照你的牌`));
    els.actions.appendChild(actionButton('同意照牌', () => {
      send('action', { type: 'respond_peek_player', accepted: true });
    }, 'primary'));
    els.actions.appendChild(actionButton('拒绝照牌', () => {
      send('action', { type: 'respond_peek_player', accepted: false });
    }, 'secondary'));
    return;
  }

  if (request.requesterId === state.playerId) {
    els.actions.appendChild(actionNote(`等待 ${target ? target.nickname : '对方'} 同意照牌`));
    return;
  }

  els.actions.appendChild(actionNote(`${requester ? requester.nickname : '玩家'} 正在等待 ${target ? target.nickname : '对方'} 回应照牌`));
}

function renderPeekTargetModal() {
  if (!els.peekTargetModal || !els.peekTargetOptions) return;
  const hand = safeHand();
  const activeIds = hand.activePlayerIds || [];
  const viewedIds = hand.viewedPlayerIds || [];
  const canChoose = state.peekTargetModalOpen
    && state.room
    && state.room.hand
    && hand.currentTurnPlayerId === state.playerId
    && activeIds.includes(state.playerId)
    && activeIds.length > 2
    && viewedIds.includes(state.playerId)
    && !(hand.peekUsedPlayerIds || []).includes(state.playerId)
    && !hand.pendingPeekRequest;

  els.peekTargetModal.hidden = !canChoose;
  els.peekTargetOptions.innerHTML = '';
  if (!canChoose) return;

  const targets = findPeekTargets();
  if (!targets.length) {
    const note = document.createElement('p');
    note.className = 'action-note';
    note.textContent = '当前没有可照牌的玩家。';
    els.peekTargetOptions.appendChild(note);
    return;
  }

  targets.forEach((targetPlayerId) => {
    const target = findPlayer(targetPlayerId);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'peek-target-option';
    button.innerHTML = `
      <span class="player-avatar" aria-hidden="true">${avatarMarkup(target?.avatarUrl)}</span>
      <strong>${escapeHtml(target ? target.nickname : '玩家')}</strong>
      <span>发送照牌请求</span>
    `;
    button.addEventListener('click', () => {
      state.peekTargetModalOpen = false;
      send('action', { type: 'peek_player', targetPlayerId });
      render();
    });
    els.peekTargetOptions.appendChild(button);
  });
}

function renderPeekResultModal() {
  if (!els.peekResultModal || !els.peekResultBody) return;
  const result = state.peekedCards && state.peekedCards.participantHands ? state.peekedCards : null;
  els.peekResultModal.hidden = !(state.peekResultModalOpen && result);
  els.peekResultBody.innerHTML = '';
  if (!state.peekResultModalOpen || !result) return;

  const requester = findPeekResultPlayer(result, result.requesterId);
  const target = findPeekResultPlayer(result, result.targetPlayerId);
  const winner = findPeekResultPlayer(result, result.winnerId);
  const summary = document.createElement('p');
  summary.className = 'peek-result-summary';
  summary.textContent = `${requester ? requester.nickname : '发起方'} vs ${target ? target.nickname : '被照方'} · 胜者 ${winner ? winner.nickname : '玩家'}`;
  els.peekResultBody.appendChild(summary);

  [result.requesterId, result.targetPlayerId].forEach((playerId) => {
    const cards = result.participantHands[playerId];
    if (!Array.isArray(cards)) return;
    const player = findPeekResultPlayer(result, playerId);
    const item = document.createElement('article');
    item.className = 'peek-result-hand';
    const label = document.createElement('p');
    label.textContent = `${player ? player.nickname : '玩家'}${playerId === result.winnerId ? ' · 赢' : ' · 输'}`;
    const row = document.createElement('div');
    row.className = 'card-row is-small';
    item.appendChild(label);
    item.appendChild(row);
    els.peekResultBody.appendChild(item);
    renderCards(row, cards);
  });
}

function renderSettlement() {
  const settlement = state.room.lastSettlement;
  els.settlementPanel.hidden = !settlement || state.room.status === 'playing';
  if (!settlement) return;
  const winnerNames = (settlement.winnerIds || []).map((id) => {
    const player = findPlayer(id);
    return player ? player.nickname : '玩家';
  }).join('、');
  els.settlementPanel.querySelector('[data-settlement-title]').textContent = `本手赢家：${winnerNames || '-'}`;
  els.settlementPanel.querySelector('[data-settlement-detail]').textContent = `奖池 ${formatCoins(settlement.pot || 0)} · ${settlement.hadNegative ? '已触发补币' : '金币正常'}`;
  renderSettlementReveals(settlement);
}

function renderSettlementReveals(settlement) {
  const previous = els.settlementPanel.querySelector('.settlement-reveals');
  if (previous) previous.remove();

  const revealIds = settlement.revealedPlayerIds || [];
  if (!revealIds.length || !settlement.hands) return;

  const list = document.createElement('div');
  list.className = 'settlement-reveals';
  revealIds.forEach((playerId) => {
    const hand = settlement.hands[playerId];
    if (!hand || !Array.isArray(hand.cards)) return;
    const player = findPlayer(playerId);
    const item = document.createElement('article');
    const title = document.createElement('p');
    title.textContent = `${player ? player.nickname : '玩家'} · ${hand.label || '牌面'}`;
    const row = document.createElement('div');
    row.className = 'card-row is-small';
    item.appendChild(title);
    item.appendChild(row);
    renderCards(row, hand.cards);
    list.appendChild(item);
  });

  if (list.children.length) els.settlementPanel.appendChild(list);
}

function renderFinal() {
  const settlement = state.room.finalSettlement;
  if (!settlement) return;
  els.rankingList.innerHTML = '';
  const header = document.createElement('li');
  header.className = 'ranking-row ranking-header';
  header.innerHTML = '<span>玩家</span><span>本金</span><span>余额</span><span>盈亏</span>';
  els.rankingList.appendChild(header);
  (settlement.ranking || []).forEach((item) => {
    const row = document.createElement('li');
    const principal = Number(item.principal ?? (state.room.config && state.room.config.initialCoins) ?? DEFAULT_ROOM_CONFIG.initialCoins);
    const balance = Number(item.coins || 0);
    const profitLoss = Number(item.profitLoss ?? (balance - principal));
    row.className = 'ranking-row';
    row.innerHTML = `
      <strong>${item.rank}. ${escapeHtml(item.nickname)}</strong>
      <span>${formatCoins(principal)}</span>
      <span>${formatCoins(balance)}</span>
      <b class="${profitLoss >= 0 ? 'is-profit' : 'is-loss'}">${formatProfitLoss(profitLoss)}</b>
    `;
    els.rankingList.appendChild(row);
  });
}

function actionButton(label, onClick, variant = 'primary', disabled = false) {
  const button = document.createElement('button');
  button.className = `action-btn is-${variant}`;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

function actionNote(text) {
  const note = document.createElement('p');
  note.className = 'action-note';
  note.textContent = text;
  return note;
}

function applyCoinSnapshot(payload = {}) {
  if (!state.room || !payload.coinsByPlayerId || typeof payload.coinsByPlayerId !== 'object') return;
  state.room.players = (state.room.players || []).map((player) => {
    if (!Object.prototype.hasOwnProperty.call(payload.coinsByPlayerId, player.id)) return player;
    return Object.assign({}, player, { coins: Number(payload.coinsByPlayerId[player.id]) });
  });
  if (state.room.hand && Number.isFinite(Number(payload.pot))) {
    state.room.hand = Object.assign({}, state.room.hand, { pot: Number(payload.pot) });
  }
}

function applySettlementCoins(settlement = {}) {
  if (!state.room || !settlement.afterCoins || typeof settlement.afterCoins !== 'object') return;
  state.room.players = (state.room.players || []).map((player) => {
    if (!Object.prototype.hasOwnProperty.call(settlement.afterCoins, player.id)) return player;
    return Object.assign({}, player, { coins: Number(settlement.afterCoins[player.id]) });
  });
}

function schedulePeekResultAutoClose() {
  if (state.peekResultTimer) clearTimeout(state.peekResultTimer);
  state.peekResultTimer = setTimeout(() => {
    closePeekResultModal();
  }, 5000);
}

function closePeekResultModal(options = {}) {
  if (state.peekResultTimer) {
    clearTimeout(state.peekResultTimer);
    state.peekResultTimer = null;
  }
  state.peekResultModalOpen = false;
  if (options.renderAfterClose === false) return;
  render();
}

function leaveRoom() {
  state.leavingRoom = true;
  send('leave_room');
  clearRoomSession('已离开房间', { keepLeaving: true });
  render();
}

function clearRoomSession(status, options = {}) {
  state.room = null;
  state.roomId = '';
  state.playerId = '';
  state.playerToken = '';
  state.peekedCards = null;
  state.peekTargetModalOpen = false;
  closePeekResultModal({ renderAfterClose: false });
  state.lastSession = null;
  if (!options.keepLeaving) state.leavingRoom = false;
  state.status = status;
  localStorage.removeItem('lastRoomSession');
}

function beginNewRoomRequest(status) {
  clearRoomSession(status);
  state.leavingRoom = false;
}

function shouldAcceptRoomState(room) {
  const roomId = String(room && room.id || '');
  return Boolean(roomId && state.roomId && roomId === state.roomId);
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return 'failed';

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return 'copied';
    } catch (error) {
      // Fall through to the selection-based copy path for restricted browsers.
    }
  }

  let wroteClipboardData = false;
  const copyHandler = (event) => {
    event.preventDefault();
    event.clipboardData.setData('text/plain', value);
    wroteClipboardData = true;
  };
  document.addEventListener('copy', copyHandler);
  try {
    if (document.execCommand('copy') && wroteClipboardData) return 'copied';
  } catch (error) {
    // Fall through to the input-based copy path below.
  } finally {
    document.removeEventListener('copy', copyHandler);
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '50%';
  textarea.style.left = '50%';
  textarea.style.width = '1px';
  textarea.style.height = '1px';
  textarea.style.opacity = '0.01';
  textarea.style.transform = 'translate(-50%, -50%)';
  textarea.style.pointerEvents = 'none';
  textarea.style.userSelect = 'text';
  textarea.style.webkitUserSelect = 'text';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    if (document.execCommand('copy')) return 'copied';
  } catch (error) {
    return showManualCopy(value);
  } finally {
    textarea.remove();
  }

  return showManualCopy(value);
}

function showManualCopy(value) {
  const previous = document.querySelector('.manual-copy-popover');
  if (previous) previous.remove();

  const popover = document.createElement('div');
  popover.className = 'manual-copy-popover';
  popover.innerHTML = `
    <label>
      <span>房间号已选中</span>
      <input value="${escapeHtml(value)}" readonly>
    </label>
    <button type="button" aria-label="关闭复制提示">关闭</button>
  `;
  document.body.appendChild(popover);
  const input = popover.querySelector('input');
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);
  popover.querySelector('button').addEventListener('click', () => popover.remove());
  setTimeout(() => popover.remove(), 8000);
  return 'manual';
}

function readRoomConfig() {
  return {
    mode: els.modeSelect.value,
    initialCoins: clampNumber(els.initialCoinsInput.value, 1, 100000000, DEFAULT_ROOM_CONFIG.initialCoins),
    baseBet: clampNumber(els.baseBetInput.value, 1, 100000000, DEFAULT_ROOM_CONFIG.baseBet),
    bonus: clampNumber(els.bonusInput.value, 0, 100000000, DEFAULT_ROOM_CONFIG.bonus),
    betOptions: parseBetOptions(els.betOptionsInput.value),
    actionTimeoutSeconds: clampNumber(els.actionTimeoutInput.value, 1, 60, 3) * 60,
  };
}

function applyDefaultConfig() {
  els.modeSelect.value = DEFAULT_ROOM_CONFIG.mode;
  els.initialCoinsInput.value = DEFAULT_ROOM_CONFIG.initialCoins;
  els.baseBetInput.value = DEFAULT_ROOM_CONFIG.baseBet;
  els.bonusInput.value = DEFAULT_ROOM_CONFIG.bonus;
  els.betOptionsInput.value = DEFAULT_ROOM_CONFIG.betOptions.join('/');
  els.actionTimeoutInput.value = Math.round(DEFAULT_ROOM_CONFIG.actionTimeoutSeconds / 60);
}

function renderAvatarPicker() {
  if (!els.avatarPicker) return;
  const currentPlayer = getCurrentPlayer();
  const selectedKey = normalizeAvatarKey(currentPlayer?.avatarUrl);
  const avatarOptions = Array.isArray(state.room?.avatarOptions) ? state.room.avatarOptions : [];
  const optionsByKey = new Map(avatarOptions.map((option) => [option.key, option]));
  const locked = state.room?.status !== 'lobby' && Boolean(selectedKey);

  els.avatarPicker.innerHTML = '';
  ZODIAC_AVATARS.forEach((avatar) => {
    const option = optionsByKey.get(avatar.key) || { disabled: false, selectedByPlayerId: '' };
    const disabled = locked || Boolean(option.disabled);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'avatar-option';
    button.dataset.avatar = avatar.key;
    button.disabled = disabled;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', avatar.label);
    button.setAttribute('aria-checked', avatar.key === selectedKey ? 'true' : 'false');
    if (avatar.key === selectedKey) button.classList.add('is-selected');
    if (disabled) {
      button.classList.add('is-taken');
      button.title = locked ? '本手开始后不能更换头像。' : '这个头像已被选择。';
    }
    button.innerHTML = `${avatarMarkup(avatar.key)}<span>${avatar.label}</span>`;
    els.avatarPicker.appendChild(button);
  });
}

function renderAvatarModal() {
  if (!els.avatarModal || !state.room) return;
  const mustChooseAvatar = !currentPlayerHasAvatar();
  const open = mustChooseAvatar || state.avatarModalOpen;
  els.avatarModal.hidden = !open;
  els.avatarModal.classList.toggle('is-required', mustChooseAvatar);
  els.closeAvatarModalBtn.hidden = mustChooseAvatar;
  els.openAvatarBtn.textContent = currentPlayerHasAvatar() ? '更换头像' : '选择头像';
  els.openAvatarBtn.disabled = state.room.status === 'finished' || (state.room.status !== 'lobby' && currentPlayerHasAvatar());
}

function syncAvatarModalState() {
  if (!state.room || !state.playerId) return;
  state.avatarModalOpen = !currentPlayerHasAvatar();
}

function syncSelectedAvatar() {
  if (!state.room || !state.playerId) return;
  const player = getCurrentPlayer();
  if (!player) return;
  const assignedAvatar = normalizeAvatarKey(player.avatarUrl);
  if (assignedAvatar === state.avatarUrl) return;
  state.avatarUrl = assignedAvatar;
  if (state.avatarUrl) localStorage.setItem('avatarUrl', state.avatarUrl);
}

function currentPlayerHasAvatar() {
  return Boolean(normalizeAvatarKey(getCurrentPlayer()?.avatarUrl));
}

function normalizeAvatarKey(value) {
  const raw = String(value || '');
  const matched = ZODIAC_AVATARS.find((avatar) => avatar.key === raw || avatar.legacy === raw || avatar.label === raw);
  return matched ? matched.key : '';
}

function avatarMarkup(value) {
  const key = normalizeAvatarKey(value);
  if (!key) return '<span class="avatar-placeholder">待选</span>';
  const avatar = getAvatarInfo(key);
  return `<img class="avatar-img" src="/avatars/${key}.png" alt="${avatar.label}">`;
}

function getAvatarInfo(value) {
  const key = normalizeAvatarKey(value);
  return key ? ZODIAC_AVATARS.find((item) => item.key === key) : null;
}

function parseBetOptions(value) {
  const options = String(value || '')
    .split(/[,\s/，]+/)
    .map((item) => Math.floor(Number(item)))
    .filter((item) => Number.isFinite(item) && item > 0);
  return options.length ? Array.from(new Set(options)).sort((a, b) => a - b) : DEFAULT_ROOM_CONFIG.betOptions;
}

function normalizeRoom(room) {
  return Object.assign({}, room, {
    players: Array.isArray(room.players) ? room.players : [],
    avatarOptions: Array.isArray(room.avatarOptions) ? room.avatarOptions : [],
    hand: room.hand ? normalizeHand(room.hand) : null,
  });
}

function normalizeHand(hand) {
  return Object.assign({
    id: '',
    pot: 0,
    currentTurnPlayerId: '',
    activePlayerIds: [],
    dealtPlayerIds: [],
    foldedPlayerIds: [],
    viewedPlayerIds: [],
    peekUsedPlayerIds: [],
    pendingPeekRequest: null,
    currentBet: null,
    legalBetOptions: [],
    canShowdown: false,
    myCards: null,
    turnStartedAt: null,
    turnDeadlineAt: null,
  }, hand || {});
}

function safeHand() {
  return state.room && state.room.hand ? normalizeHand(state.room.hand) : normalizeHand({});
}

function playerPayload() {
  return { nickname: state.nickname || randomNickname() };
}

function isHost() {
  return state.room && state.room.hostId === state.playerId;
}

function findPlayer(playerId) {
  return state.room && state.room.players ? state.room.players.find((player) => player.id === playerId) : null;
}

function getCurrentPlayer() {
  return findPlayer(state.playerId);
}

function findPeekTarget() {
  return findPeekTargets()[0] || '';
}

function findPeekTargets() {
  const hand = safeHand();
  const activeIds = hand.activePlayerIds || [];
  const viewedIds = hand.viewedPlayerIds || [];
  if (activeIds.length <= 2) return [];
  return activeIds.filter((id) => id !== state.playerId && viewedIds.includes(id));
}

function findPeekResultPlayer(result, playerId) {
  return (result.participants && result.participants[playerId]) || findPlayer(playerId);
}

function describeAction(payload) {
  const player = findPlayer(payload.playerId);
  const name = player ? player.nickname : '玩家';
  const labels = {
    bet: `下注 ${payload.amount}`,
    fold: '弃牌',
    view_self: '看牌',
    peek_player: payload.winnerId ? '完成照牌' : '请求照牌',
    respond_peek_player: payload.accepted ? '同意照牌' : '拒绝照牌',
    showdown: '开牌',
    timeout_fold: '超时弃牌',
  };
  return `${name}${labels[payload.action] || '行动'}`;
}

function renderTurnClock() {
  if (!state.room || !state.room.hand) return;
  const hand = safeHand();
  renderCurrentTurnText(hand);
  renderTableTurnTimer(hand);
}

function formatTurnTimer(deadlineAt) {
  const totalSeconds = getTurnRemainingSeconds(deadlineAt);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getTurnRemainingSeconds(deadlineAt) {
  if (!deadlineAt) return 0;
  const remaining = Math.max(0, Number(deadlineAt) - Date.now());
  return Math.ceil(remaining / 1000);
}

function formatCoins(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatProfitLoss(value) {
  const number = Number(value || 0);
  const sign = number >= 0 ? '+' : '-';
  return `${sign}${formatCoins(Math.abs(number))}`;
}

function clampNumber(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function randomNickname() {
  return `玩家${Math.floor(Math.random() * 9000 + 1000)}`;
}

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (error) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message) {
  state.status = message;
  renderStatus();
}

function getModeRules(mode) {
  return MODE_RULES[mode] || MODE_RULES.zha_jing_hua;
}

function animateChipThrow(payload) {
  const amount = Number(payload.amount || 0);
  if (!amount || !state.room) return;

  const sourceLabel = document.querySelector(`[data-player-id="${CSS.escape(payload.playerId || '')}"]`);
  const target = els.potText;
  const sourceRect = sourceLabel ? sourceLabel.getBoundingClientRect() : null;
  const targetRect = target ? target.getBoundingClientRect() : null;
  if (!targetRect) return;

  const startX = sourceRect ? sourceRect.left + sourceRect.width / 2 : window.innerWidth / 2;
  const startY = sourceRect ? sourceRect.top + sourceRect.height / 2 : window.innerHeight - 120;
  const endX = targetRect.left + targetRect.width / 2;
  const endY = targetRect.top + targetRect.height / 2;
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2 - 130;
  const chip = document.createElement('div');
  chip.className = 'table-chip-throw';
  chip.textContent = amount;
  chip.style.setProperty('--chip-start-x', `${startX}px`);
  chip.style.setProperty('--chip-start-y', `${startY}px`);
  chip.style.setProperty('--chip-mid-x', `${midX}px`);
  chip.style.setProperty('--chip-mid-y', `${midY}px`);
  chip.style.setProperty('--chip-end-x', `${endX}px`);
  chip.style.setProperty('--chip-end-y', `${endY}px`);
  document.body.appendChild(chip);
  chip.addEventListener('animationend', () => chip.remove(), { once: true });
}

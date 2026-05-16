const DEFAULT_ROOM_CONFIG = {
  mode: 'zha_jing_hua',
  maxPlayers: 6,
  baseBet: 5,
  bonus: 50,
  betOptions: [5, 10, 20, 50],
  actionTimeoutSeconds: 180,
};

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
  leavingRoom: false,
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
  'roomCodeText',
  'copyRoomBtn',
  'playerList',
  'startHandBtn',
  'leaveRoomBtn',
  'potText',
  'currentTurnText',
  'myCards',
  'peekedCards',
  'actions',
  'settlementPanel',
  'continueHandBtn',
  'finishGameBtn',
  'rankingList',
  'backHomeBtn',
  'modeSelect',
  'maxPlayersInput',
  'baseBetInput',
  'bonusInput',
  'betOptionsInput',
  'actionTimeoutInput',
].forEach((id) => {
  els[id] = $(id);
});

init();

function init() {
  if (els.nicknameInput) els.nicknameInput.value = state.nickname;
  renderAvatarPicker();
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

  els.avatarPicker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-avatar]');
    if (!button) return;
    state.avatarUrl = button.dataset.avatar;
    localStorage.setItem('avatarUrl', state.avatarUrl);
    renderAvatarPicker();
  });

  els.createRoomBtn.addEventListener('click', () => {
    state.leavingRoom = false;
    state.status = '正在创建房间...';
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
    state.leavingRoom = false;
    state.status = '正在加入房间...';
    render();
    send('join_room', { roomId, player: playerPayload() });
  });

  els.copyRoomBtn.addEventListener('click', async () => {
    if (!state.room) return;
    if (await copyTextToClipboard(state.room.id)) {
      toast('房间号已复制');
    } else {
      toast(`复制失败，房间号：${state.room.id}`);
    }
  });

  els.startHandBtn.addEventListener('click', () => send('start_hand'));
  els.continueHandBtn.addEventListener('click', () => send('start_hand'));
  els.finishGameBtn.addEventListener('click', () => send('finish_game'));
  els.leaveRoomBtn.addEventListener('click', leaveRoom);
  els.backHomeBtn.addEventListener('click', () => {
    state.room = null;
    state.peekedCards = null;
    state.status = '已返回首页';
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
    state.roomId = payload.roomId;
    state.playerId = payload.playerId;
    state.playerToken = payload.playerToken;
    state.lastSession = payload;
    localStorage.setItem('lastRoomSession', JSON.stringify(payload));
  }

  if (message.type === 'room_state') {
    if (state.leavingRoom) return;
    state.room = normalizeRoom(payload);
    state.roomId = state.room.id;
    if (!state.room.hand) state.peekedCards = null;
    if (state.room.finalSettlement) state.status = '游戏已结算';
  }

  if (message.type === 'hand_state' && state.room) {
    state.room.hand = normalizeHand(payload.hand || payload);
  }

  if (message.type === 'private_cards') {
    if (payload.targetPlayerId === state.playerId) {
      if (state.room && state.room.hand) state.room.hand.myCards = payload.cards;
      state.status = '已看自己的牌';
    } else {
      state.peekedCards = payload;
      state.status = '已照对手牌';
    }
  }

  if (message.type === 'action_result') {
    state.status = describeAction(payload);
  }

  if (message.type === 'hand_settlement' && state.room) {
    state.room.lastSettlement = payload;
    state.peekedCards = null;
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
  renderViews();
  if (!state.room) return;
  renderRoom();
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
  const summary = `${MODE_LABELS[config.mode] || config.mode} · 底注 ${config.baseBet} · 喜钱 ${config.bonus} · ${timeoutMinutes}分钟行动`;
  const roomMeta = document.querySelector('[data-room-meta]');
  if (roomMeta) roomMeta.textContent = summary;
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
  els.startHandBtn.hidden = !host || state.room.status !== 'lobby';
  els.startHandBtn.disabled = !host || players.length < 2 || state.room.status !== 'lobby';
  els.continueHandBtn.hidden = !host || state.room.status !== 'between_hands';
  els.continueHandBtn.disabled = !host || state.room.status !== 'between_hands';
  els.finishGameBtn.hidden = !host;
  els.finishGameBtn.disabled = !host || state.room.status === 'playing';
}

function renderHand() {
  const hand = safeHand();
  els.potText.textContent = formatCoins(hand.pot || 0);
  const current = findPlayer(hand.currentTurnPlayerId);
  const timer = formatTurnTimer(hand.turnDeadlineAt);
  els.currentTurnText.textContent = current ? `${current.nickname}${timer ? ` · ${timer}` : ''}` : '-';
  renderCards(els.myCards, hand.myCards);
  renderPeekedCards();
  renderActions();
}

function renderCards(container, cards) {
  container.innerHTML = '';
  for (let i = 0; i < 3; i += 1) {
    const card = cards && cards[i] ? cards[i] : null;
    const element = document.createElement('div');
    element.className = card ? 'playing-card' : 'playing-card is-back';
    if (card && RED_SUITS[card.suit]) element.classList.add('is-red');
    element.innerHTML = card ? `<span>${card.rank}</span><b>${SUITS[card.suit] || card.suit}</b>` : '<span>?</span>';
    container.appendChild(element);
  }
}

function renderPeekedCards() {
  els.peekedCards.innerHTML = '';
  if (!state.peekedCards) return;
  const target = findPlayer(state.peekedCards.targetPlayerId);
  const title = document.createElement('p');
  title.textContent = `照牌：${target ? target.nickname : '对手'}`;
  els.peekedCards.appendChild(title);
  const row = document.createElement('div');
  row.className = 'card-row is-small';
  els.peekedCards.appendChild(row);
  renderCards(row, state.peekedCards.cards);
}

function renderActions() {
  const hand = safeHand();
  const activeIds = hand.activePlayerIds || [];
  const viewedIds = hand.viewedPlayerIds || [];
  const peekUsedIds = hand.peekUsedPlayerIds || [];
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
    els.actions.appendChild(actionNote('你已弃牌，等待结算'));
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
  els.actions.appendChild(actionButton(peekUsedIds.includes(state.playerId) ? '已照牌' : '照牌', () => {
    const targetPlayerId = findPeekTarget();
    if (targetPlayerId) send('action', { type: 'peek_player', targetPlayerId });
  }, 'secondary', peekUsedIds.includes(state.playerId) || !findPeekTarget() || !enabledBetOptions.length));
  const defaultBet = enabledBetOptions[0] ? enabledBetOptions[0].amount : options[0];
  els.actions.appendChild(actionButton('开牌', () => {
    send('action', { type: 'showdown' });
  }, 'primary', !hand.canShowdown || !enabledBetOptions.length));
  els.actions.lastChild.textContent = `开牌 ${defaultBet}`;
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
  (settlement.ranking || []).forEach((item) => {
    const row = document.createElement('li');
    row.innerHTML = `<strong>${item.rank}. ${escapeHtml(item.nickname)}</strong><b>${formatCoins(item.coins)}</b>`;
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
  state.lastSession = null;
  if (!options.keepLeaving) state.leavingRoom = false;
  state.status = status;
  localStorage.removeItem('lastRoomSession');
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      // Fall through to the selection-based copy path for restricted browsers.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand('copy');
  } catch (error) {
    return false;
  } finally {
    textarea.remove();
  }
}

function readRoomConfig() {
  return {
    mode: els.modeSelect.value,
    maxPlayers: clampNumber(els.maxPlayersInput.value, 2, 12, DEFAULT_ROOM_CONFIG.maxPlayers),
    baseBet: clampNumber(els.baseBetInput.value, 1, 100000000, DEFAULT_ROOM_CONFIG.baseBet),
    bonus: clampNumber(els.bonusInput.value, 0, 100000000, DEFAULT_ROOM_CONFIG.bonus),
    betOptions: parseBetOptions(els.betOptionsInput.value),
    actionTimeoutSeconds: clampNumber(els.actionTimeoutInput.value, 1, 60, 3) * 60,
  };
}

function applyDefaultConfig() {
  els.modeSelect.value = DEFAULT_ROOM_CONFIG.mode;
  els.maxPlayersInput.value = DEFAULT_ROOM_CONFIG.maxPlayers;
  els.baseBetInput.value = DEFAULT_ROOM_CONFIG.baseBet;
  els.bonusInput.value = DEFAULT_ROOM_CONFIG.bonus;
  els.betOptionsInput.value = DEFAULT_ROOM_CONFIG.betOptions.join('/');
  els.actionTimeoutInput.value = Math.round(DEFAULT_ROOM_CONFIG.actionTimeoutSeconds / 60);
}

function renderAvatarPicker() {
  if (!els.avatarPicker) return;
  els.avatarPicker.innerHTML = '';
  ZODIAC_AVATARS.forEach((avatar) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'avatar-option';
    button.dataset.avatar = avatar.key;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-label', avatar.label);
    button.setAttribute('aria-checked', avatar.key === state.avatarUrl ? 'true' : 'false');
    if (avatar.key === state.avatarUrl) button.classList.add('is-selected');
    button.innerHTML = `${avatarMarkup(avatar.key)}<span>${avatar.label}</span>`;
    els.avatarPicker.appendChild(button);
  });
}

function normalizeAvatarKey(value) {
  const raw = String(value || '');
  const matched = ZODIAC_AVATARS.find((avatar) => avatar.key === raw || avatar.legacy === raw || avatar.label === raw);
  return matched ? matched.key : ZODIAC_AVATARS[0].key;
}

function avatarMarkup(value) {
  const key = normalizeAvatarKey(value);
  const avatar = ZODIAC_AVATARS.find((item) => item.key === key) || ZODIAC_AVATARS[0];
  return `<img class="avatar-img" src="/avatars/${key}.png" alt="${avatar.label}">`;
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
    hand: room.hand ? normalizeHand(room.hand) : null,
  });
}

function normalizeHand(hand) {
  return Object.assign({
    id: '',
    pot: 0,
    currentTurnPlayerId: '',
    activePlayerIds: [],
    foldedPlayerIds: [],
    viewedPlayerIds: [],
    peekUsedPlayerIds: [],
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
  return { nickname: state.nickname || randomNickname(), avatarUrl: normalizeAvatarKey(state.avatarUrl) };
}

function isHost() {
  return state.room && state.room.hostId === state.playerId;
}

function findPlayer(playerId) {
  return state.room && state.room.players ? state.room.players.find((player) => player.id === playerId) : null;
}

function findPeekTarget() {
  const hand = safeHand();
  const activeIds = hand.activePlayerIds || [];
  const viewedIds = hand.viewedPlayerIds || [];
  return activeIds.find((id) => id !== state.playerId && viewedIds.includes(id)) || '';
}

function describeAction(payload) {
  const player = findPlayer(payload.playerId);
  const name = player ? player.nickname : '玩家';
  const labels = {
    bet: `下注 ${payload.amount}`,
    fold: '弃牌',
    view_self: '看牌',
    peek_player: '照牌',
    showdown: '开牌',
    timeout_fold: '超时弃牌',
  };
  return `${name}${labels[payload.action] || '行动'}`;
}

function renderTurnClock() {
  if (!state.room || !state.room.hand) return;
  renderHand();
}

function formatTurnTimer(deadlineAt) {
  if (!deadlineAt) return '';
  const remaining = Math.max(0, Number(deadlineAt) - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatCoins(value) {
  return Number(value || 0).toLocaleString('zh-CN');
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

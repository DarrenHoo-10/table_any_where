const crypto = require('crypto');
const {
  MAX_COINS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  compareHands,
  dealHands,
  evaluateHand,
  findWinningPlayerIds,
  handSummary,
  normalizeConfig,
  publicCard,
} = require('./rules');

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ZODIAC_AVATAR_KEYS = [
  'rat',
  'ox',
  'tiger',
  'rabbit',
  'dragon',
  'snake',
  'horse',
  'goat',
  'monkey',
  'rooster',
  'dog',
  'pig',
];

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function createRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function normalizeAvatarKey(value) {
  const raw = String(value || '');
  return ZODIAC_AVATAR_KEYS.includes(raw) ? raw : '';
}

function createPlayer(info = {}, initialCoins) {
  return {
    id: createId('player'),
    token: createId('token'),
    nickname: String(info.nickname || '玩家').slice(0, 16),
    avatarUrl: '',
    coins: initialCoins,
    connected: true,
    seat: 0,
  };
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRoom = new Map();
  }

  createRoom(playerInfo, rawConfig) {
    const config = normalizeConfig(rawConfig);
    let roomId = createRoomCode();
    while (this.rooms.has(roomId)) roomId = createRoomCode();

    const host = createPlayer(playerInfo, config.initialCoins);
    host.seat = 1;
    const room = {
      id: roomId,
      hostId: host.id,
      config,
      status: 'lobby',
      players: [host],
      hand: null,
      lastSettlement: null,
      finalSettlement: null,
      createdAt: Date.now(),
    };

    this.rooms.set(roomId, room);
    this.playerRoom.set(host.id, roomId);

    return { room, player: host };
  }

  joinRoom(roomId, playerInfo) {
    const room = this.requireRoom(roomId);
    if (room.status === 'finished') throw new Error('房间已经结算，不能加入。');
    if (room.players.length >= room.config.maxPlayers) throw new Error('房间人数已满。');

    const player = createPlayer(playerInfo, room.config.initialCoins);
    player.seat = room.players.length + 1;
    room.players.push(player);
    this.playerRoom.set(player.id, room.id);

    return { room, player };
  }

  selectAvatar(roomId, playerId, avatarKey) {
    const room = this.requireRoom(roomId);
    if (room.status === 'finished') throw new Error('房间已经结算，不能选择头像。');
    const player = this.requirePlayer(room, playerId);
    if (room.status !== 'lobby' && normalizeAvatarKey(player.avatarUrl)) {
      throw new Error('本局开始后不能更换头像。');
    }
    const normalizedAvatarKey = normalizeAvatarKey(avatarKey);
    if (!normalizedAvatarKey) throw new Error('请选择有效头像。');
    const takenByOther = room.players.find((item) => item.id !== playerId && item.avatarUrl === normalizedAvatarKey);
    if (takenByOther) throw new Error('这个头像已被选择。');
    player.avatarUrl = normalizedAvatarKey;
    return { room, player };
  }

  reconnect(roomId, playerId, token) {
    const room = this.requireRoom(roomId);
    const player = room.players.find((item) => item.id === playerId && item.token === token);
    if (!player) throw new Error('重连身份无效。');
    player.connected = true;
    return { room, player };
  }

  markDisconnected(playerId) {
    const room = this.getPlayerRoom(playerId);
    if (!room) return null;
    const player = room.players.find((item) => item.id === playerId);
    if (player) player.connected = false;
    return room;
  }

  kickDisconnectedPlayer(playerId) {
    const room = this.getPlayerRoom(playerId);
    if (!room) return null;
    const player = room.players.find((item) => item.id === playerId);
    if (!player || player.connected) return null;
    const roomId = room.id;
    return {
      roomId,
      room: this.leaveRoom(playerId),
      player,
    };
  }

  leaveRoom(playerId) {
    const room = this.getPlayerRoom(playerId);
    if (!room) return null;
    const leavingIndex = room.players.findIndex((player) => player.id === playerId);
    const leavingHost = room.hostId === playerId;

    if (room.status === 'playing') {
      const hand = room.hand;
      if (hand && hand.activePlayerIds.includes(playerId)) {
        const wasCurrentTurn = hand.currentTurnPlayerId === playerId;
        this.clearPendingPeekIfParticipant(hand, playerId);
        hand.foldedPlayerIds.push(playerId);
        hand.activePlayerIds = hand.activePlayerIds.filter((id) => id !== playerId);
        hand.actionLog.push({ type: 'leave_fold', playerId, at: Date.now() });

        if (hand.activePlayerIds.length === 1) {
          this.settleHand(room, 'player_left');
        } else if (wasCurrentTurn) {
          this.advanceTurnAfterPlayer(room, playerId);
        }
      }
    }

    this.playerRoom.delete(playerId);
    room.players = room.players.filter((player) => player.id !== playerId);
    room.players.forEach((player, index) => {
      player.seat = index + 1;
    });

    if (room.players.length === 0) {
      this.rooms.delete(room.id);
      return null;
    }

    if (leavingHost) {
      const nextHostIndex = Math.max(0, leavingIndex) % room.players.length;
      room.hostId = room.players[nextHostIndex].id;
    }

    return room;
  }

  startHand(roomId, playerId, now = Date.now()) {
    const room = this.requireRoom(roomId);
    this.requireHost(room, playerId);
    if (!['lobby', 'between_hands'].includes(room.status)) {
      throw new Error('当前状态不能开牌。');
    }
    if (room.players.length < MIN_PLAYERS) throw new Error('至少需要1名玩家。');
    if (room.players.length > MAX_PLAYERS) throw new Error('最多支持12名玩家。');
    if (room.players.some((player) => !normalizeAvatarKey(player.avatarUrl))) {
      throw new Error('所有玩家请选择头像后再开始发牌。');
    }
    if (room.finalSettlement) throw new Error('房间已经结算。');

    const playerIds = room.players.map((player) => player.id);
    const currentTurnPlayerId = this.getOpeningTurnPlayerId(room, playerIds);
    const hands = dealHands(playerIds);
    let pot = 0;
    room.players.forEach((player) => {
      player.coins -= room.config.baseBet;
      pot += room.config.baseBet;
    });

    room.status = 'playing';
    room.lastSettlement = null;
    room.hand = {
      id: createId('hand'),
      hands,
      pot,
      dealtPlayerIds: playerIds.slice(),
      activePlayerIds: playerIds.slice(),
      foldedPlayerIds: [],
      viewedPlayerIds: [],
      peekUsedPlayerIds: [],
      pendingPeekRequest: null,
      currentBet: null,
      currentTurnPlayerId,
      actionLog: [],
      startedAt: now,
      turnStartedAt: now,
      turnDeadlineAt: this.getTurnDeadline(room, now),
    };

    return room;
  }

  finishGame(roomId, playerId, reason = 'host_finished') {
    const room = this.requireRoom(roomId);
    this.requireHost(room, playerId);
    if (room.status === 'playing') throw new Error('本手牌尚未结束，不能最终结算。');
    return this.createFinalSettlement(room, reason);
  }

  handleAction(roomId, playerId, action = {}) {
    const room = this.requireRoom(roomId);
    const hand = room.hand;
    if (room.status !== 'playing' || !hand) throw new Error('当前没有进行中的牌局。');

    const type = action.type;
    if (type === 'view_self') return this.viewSelf(room, playerId);
    if (type === 'respond_peek_player') return this.respondPeekPlayer(room, playerId, action.accepted);

    this.requireTurn(room, playerId);
    this.requireNoPendingPeek(room);

    if (type === 'bet') return this.bet(room, playerId, action.amount);
    if (type === 'fold') return this.fold(room, playerId);
    if (type === 'peek_player') return this.requestPeekPlayer(room, playerId, action.targetPlayerId);
    if (type === 'showdown') return this.showdown(room, playerId, action.amount);

    throw new Error('未知操作。');
  }

  viewSelf(room, playerId) {
    const hand = room.hand;
    if (!hand.activePlayerIds.includes(playerId)) throw new Error('弃牌后不能看牌。');
    if (!hand.viewedPlayerIds.includes(playerId)) hand.viewedPlayerIds.push(playerId);
    hand.actionLog.push({ type: 'view_self', playerId, at: Date.now() });
    return { room, privateTo: playerId, privateCards: hand.hands[playerId].map(publicCard) };
  }

  bet(room, playerId, amount) {
    const normalizedAmount = this.requireLegalBet(room, playerId, amount);
    const cost = this.getActionCost(room, playerId, normalizedAmount);
    const player = this.requirePlayer(room, playerId);
    player.coins -= cost;
    room.hand.pot += cost;
    room.hand.currentBet = {
      playerId,
      amount: normalizedAmount,
      viewed: this.hasViewed(room, playerId),
    };
    room.hand.actionLog.push({ type: 'bet', playerId, amount: normalizedAmount, cost, at: Date.now() });
    this.advanceTurn(room);
    return { room };
  }

  fold(room, playerId) {
    const hand = room.hand;
    if (!hand.activePlayerIds.includes(playerId)) throw new Error('你已经弃牌。');
    hand.foldedPlayerIds.push(playerId);
    hand.activePlayerIds = hand.activePlayerIds.filter((id) => id !== playerId);
    hand.actionLog.push({ type: 'fold', playerId, at: Date.now() });

    if (hand.activePlayerIds.length === 1) {
      this.settleHand(room, 'last_player');
    } else {
      this.advanceTurnAfterPlayer(room, playerId);
    }

    return { room };
  }

  requestPeekPlayer(room, playerId, targetPlayerId) {
    const hand = room.hand;
    if (hand.activePlayerIds.length <= 2) throw new Error('只剩两名玩家时请直接开牌。');
    if (hand.peekUsedPlayerIds.includes(playerId)) throw new Error('本手牌已经照牌过一次。');
    if (!hand.activePlayerIds.includes(targetPlayerId)) throw new Error('只能照未弃牌玩家。');
    if (targetPlayerId === playerId) throw new Error('不能照自己的牌。');
    if (!hand.viewedPlayerIds.includes(playerId)) throw new Error('看牌后才可以照牌。');
    if (!hand.viewedPlayerIds.includes(targetPlayerId)) throw new Error('只能照已经看过自己的牌的玩家。');

    const cost = this.getCurrentBetCost(room, playerId);
    hand.pendingPeekRequest = {
      requesterId: playerId,
      targetPlayerId,
      cost,
      requestedAt: Date.now(),
    };
    hand.actionLog.push({ type: 'peek_request', playerId, targetPlayerId, cost, at: Date.now() });

    return { room, pendingPeekRequest: Object.assign({}, hand.pendingPeekRequest) };
  }

  respondPeekPlayer(room, playerId, accepted) {
    const hand = room.hand;
    const request = hand.pendingPeekRequest;
    if (!request) throw new Error('当前没有待处理的照牌请求。');
    if (request.targetPlayerId !== playerId) throw new Error('只有被照牌的玩家可以回应。');
    if (!hand.activePlayerIds.includes(request.requesterId) || !hand.activePlayerIds.includes(request.targetPlayerId)) {
      hand.pendingPeekRequest = null;
      throw new Error('照牌双方必须都在本手牌中。');
    }

    if (!accepted) {
      hand.pendingPeekRequest = null;
      hand.actionLog.push({
        type: 'peek_response',
        playerId,
        requesterId: request.requesterId,
        targetPlayerId: request.targetPlayerId,
        accepted: false,
        at: Date.now(),
      });
      return { room, accepted: false, requesterId: request.requesterId, targetPlayerId: request.targetPlayerId };
    }

    return this.resolvePeekPlayer(room, request);
  }

  resolvePeekPlayer(room, request) {
    const hand = room.hand;
    const playerId = request.requesterId;
    const targetPlayerId = request.targetPlayerId;
    const player = this.requirePlayer(room, playerId);
    const cost = request.cost;
    player.coins -= cost;
    hand.pot += cost;
    hand.peekUsedPlayerIds.push(playerId);
    hand.pendingPeekRequest = null;
    const compareResult = compareHands(hand.hands[playerId], hand.hands[targetPlayerId], room.config.mode);
    const winnerId = compareResult > 0 ? playerId : targetPlayerId;
    const loserId = winnerId === playerId ? targetPlayerId : playerId;
    const participantHands = {
      [playerId]: hand.hands[playerId].map(publicCard),
      [targetPlayerId]: hand.hands[targetPlayerId].map(publicCard),
    };
    const participants = Object.fromEntries(
      [playerId, targetPlayerId].map((participantId) => {
        const participant = this.requirePlayer(room, participantId);
        return [participantId, {
          id: participant.id,
          nickname: participant.nickname,
          avatarUrl: participant.avatarUrl,
        }];
      })
    );
    const privateMessages = [
      {
        privateTo: playerId,
        privateCards: hand.hands[targetPlayerId].map(publicCard),
        peekTargetPlayerId: targetPlayerId,
        peekResultTargetPlayerId: targetPlayerId,
        peekRequesterId: playerId,
        winnerId,
        loserId,
        participantHands,
        participants,
      },
      {
        privateTo: targetPlayerId,
        privateCards: hand.hands[playerId].map(publicCard),
        peekTargetPlayerId: playerId,
        peekResultTargetPlayerId: targetPlayerId,
        peekRequesterId: playerId,
        winnerId,
        loserId,
        participantHands,
        participants,
      },
    ];

    hand.foldedPlayerIds.push(loserId);
    hand.activePlayerIds = hand.activePlayerIds.filter((id) => id !== loserId);
    hand.actionLog.push({
      type: 'peek_response',
      playerId: targetPlayerId,
      requesterId: playerId,
      targetPlayerId,
      accepted: true,
      at: Date.now(),
    });
    hand.actionLog.push({ type: 'peek_player', playerId, targetPlayerId, winnerId, loserId, cost, at: Date.now() });

    if (hand.activePlayerIds.length === 1) {
      this.settleHand(room, 'mirror_card', [playerId, targetPlayerId]);
    } else if (loserId === playerId) {
      this.advanceTurnAfterPlayer(room, loserId);
    } else {
      this.advanceTurn(room);
    }

    return {
      room,
      privateMessages,
      accepted: true,
      requesterId: playerId,
      targetPlayerId,
      winnerId,
      loserId,
    };
  }

  showdown(room, playerId, amount) {
    const hand = room.hand;
    if (![1, 2].includes(hand.activePlayerIds.length)) throw new Error('只剩一名或两名玩家时才能开牌。');
    const isSoloShowdown = hand.activePlayerIds.length === 1;
    const normalizedAmount = isSoloShowdown
      ? 0
      : amount === undefined || amount === null || amount === ''
      ? this.getCurrentBetCost(room, playerId)
      : this.requireLegalBet(room, playerId, amount);
    const cost = this.getActionCost(room, playerId, normalizedAmount);
    const player = this.requirePlayer(room, playerId);
    player.coins -= cost;
    hand.pot += cost;
    hand.actionLog.push({ type: 'showdown', playerId, amount: normalizedAmount, cost, at: Date.now() });
    this.settleHand(room, 'showdown', hand.activePlayerIds.slice());
    return { room, amount: normalizedAmount };
  }

  settleHand(room, reason, revealedPlayerIds = []) {
    const hand = room.hand;
    const dealtPlayerIds = this.getDealtPlayerIds(hand);
    const dealtPlayerIdSet = new Set(dealtPlayerIds);
    const contenderIds = hand.activePlayerIds.slice();
    const winnerIds = contenderIds.length === 1
      ? contenderIds
      : findWinningPlayerIds(contenderIds, hand.hands, room.config.mode);
    const share = Math.floor(hand.pot / winnerIds.length);
    let remainder = hand.pot - share * winnerIds.length;
    const beforeCoins = Object.fromEntries(room.players.map((player) => [player.id, player.coins]));

    winnerIds.forEach((winnerId) => {
      const player = this.requirePlayer(room, winnerId);
      player.coins += share + (remainder > 0 ? 1 : 0);
      remainder -= 1;
    });

    const bonusTransfers = [];
    const handPlayers = room.players.filter((player) => dealtPlayerIdSet.has(player.id));
    const leopardPlayerIds = handPlayers
      .filter((player) => evaluateHand(hand.hands[player.id], room.config.mode).type === 'triple')
      .map((player) => player.id);

    leopardPlayerIds.forEach((winnerId) => {
      handPlayers.forEach((payer) => {
        if (payer.id === winnerId || room.config.bonus === 0) return;
        const receiver = this.requirePlayer(room, winnerId);
        payer.coins -= room.config.bonus;
        receiver.coins += room.config.bonus;
        bonusTransfers.push({ fromPlayerId: payer.id, toPlayerId: winnerId, amount: room.config.bonus });
      });
    });

    const supportCoinPlayerIds = [];
    room.players.forEach((player) => {
      if (player.coins <= 0) {
        player.coins += room.config.initialCoins;
        supportCoinPlayerIds.push(player.id);
      }
    });
    const hadNegative = supportCoinPlayerIds.length > 0;

    const capExceeded = room.players.some((player) => player.coins > MAX_COINS);
    const handSummaries = Object.fromEntries(
      handPlayers.map((player) => [player.id, handSummary(hand.hands[player.id], room.config.mode)])
    );

    room.lastSettlement = {
      type: 'hand_settlement',
      reason,
      pot: hand.pot,
      winnerIds,
      revealedPlayerIds: revealedPlayerIds.slice(),
      beforeCoins,
      afterCoins: Object.fromEntries(room.players.map((player) => [player.id, player.coins])),
      bonusTransfers,
      supportCoinPlayerIds,
      hadNegative,
      capExceeded,
      hands: handSummaries,
      settledAt: Date.now(),
    };
    room.hand = null;
    room.status = 'between_hands';

    if (capExceeded) {
      this.createFinalSettlement(room, 'coin_cap_exceeded');
    }
  }

  createFinalSettlement(room, reason) {
    room.status = 'finished';
    const principal = room.config.initialCoins;
    room.finalSettlement = {
      type: 'final_settlement',
      reason,
      ranking: room.players
        .slice()
        .sort((a, b) => b.coins - a.coins || a.seat - b.seat)
        .map((player, index) => ({
          rank: index + 1,
          playerId: player.id,
          nickname: player.nickname,
          avatarUrl: player.avatarUrl,
          principal,
          coins: player.coins,
          profitLoss: player.coins - principal,
        })),
      settledAt: Date.now(),
    };

    return room.finalSettlement;
  }

  requireRoom(roomId) {
    const room = this.rooms.get(String(roomId || '').toUpperCase());
    if (!room) throw new Error('房间不存在。');
    return room;
  }

  getPlayerRoom(playerId) {
    const roomId = this.playerRoom.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  requireHost(room, playerId) {
    if (room.hostId !== playerId) throw new Error('只有房主可以操作。');
  }

  requireTurn(room, playerId) {
    if (room.hand.currentTurnPlayerId !== playerId) throw new Error('还没轮到你。');
  }

  requireNoPendingPeek(room) {
    if (room.hand.pendingPeekRequest) throw new Error('正在等待照牌回应。');
  }

  getDealtPlayerIds(hand) {
    return Array.isArray(hand.dealtPlayerIds) ? hand.dealtPlayerIds.slice() : Object.keys(hand.hands || {});
  }

  clearPendingPeekIfParticipant(hand, playerId) {
    if (
      hand.pendingPeekRequest
      && [hand.pendingPeekRequest.requesterId, hand.pendingPeekRequest.targetPlayerId].includes(playerId)
    ) {
      hand.pendingPeekRequest = null;
    }
  }

  requirePlayer(room, playerId) {
    const player = room.players.find((item) => item.id === playerId);
    if (!player) throw new Error('玩家不存在。');
    return player;
  }

  requireBetOption(room, amount) {
    const normalizedAmount = Math.floor(Number(amount));
    if (!room.config.betOptions.includes(normalizedAmount)) {
      throw new Error('下注金额不在房间档位内。');
    }
    return normalizedAmount;
  }

  requireLegalBet(room, playerId, amount) {
    const normalizedAmount = this.requireBetOption(room, amount);
    const legalBet = this.getLegalBetOptions(room, playerId).find((option) => option.amount === normalizedAmount);
    if (!legalBet || legalBet.disabled) {
      throw new Error(legalBet?.reason || '当前不能选择这个下注档。');
    }
    return normalizedAmount;
  }

  getActionCost(room, playerId, amount) {
    return amount;
  }

  getCurrentBetCost(room, playerId) {
    const legalOptions = this.getLegalBetOptions(room, playerId).filter((option) => !option.disabled);
    if (!legalOptions.length) throw new Error('当前没有可用的下注档。');
    return legalOptions[0].amount;
  }

  getLegalBetOptions(room, playerId) {
    const minimum = this.getMinimumBetAmount(room, playerId);
    return room.config.betOptions.map((amount) => {
      if (amount < minimum) {
        return {
          amount,
          cost: this.getActionCost(room, playerId, amount),
          disabled: true,
          reason: `下注金额低于当前需要的 ${minimum}。`,
        };
      }
      if (!this.hasViewed(room, playerId) && !this.canOpenPlayerCallBlindBet(room, amount)) {
        return {
          amount,
          cost: this.getActionCost(room, playerId, amount),
          disabled: true,
          reason: '闷牌下注不能超过看牌玩家可跟注的最高档。',
        };
      }
      return {
        amount,
        cost: this.getActionCost(room, playerId, amount),
        disabled: false,
      };
    });
  }

  getMinimumBetAmount(room, playerId) {
    const hand = room.hand;
    if (!hand || !hand.currentBet) return room.config.baseBet;

    const currentIndex = this.getBetOptionIndex(room, hand.currentBet.amount);
    const playerViewed = this.hasViewed(room, playerId);
    if (playerViewed === hand.currentBet.viewed) return hand.currentBet.amount;
    if (hand.currentBet.viewed && !playerViewed) {
      return room.config.betOptions[Math.max(0, currentIndex - 1)];
    }
    return room.config.betOptions[Math.min(room.config.betOptions.length - 1, currentIndex + 1)];
  }

  getBetOptionIndex(room, amount) {
    const exactIndex = room.config.betOptions.indexOf(amount);
    if (exactIndex !== -1) return exactIndex;
    const nextIndex = room.config.betOptions.findIndex((option) => option >= amount);
    return nextIndex === -1 ? room.config.betOptions.length - 1 : nextIndex;
  }

  canOpenPlayerCallBlindBet(room, amount) {
    return room.config.betOptions.some((option) => option >= amount * 2);
  }

  hasViewed(room, playerId) {
    return Boolean(room.hand && room.hand.viewedPlayerIds.includes(playerId));
  }

  advanceTurn(room) {
    const hand = room.hand;
    if (!hand || hand.activePlayerIds.length === 0) return;
    const nextPlayerId = this.findNextActivePlayerId(room, hand.currentTurnPlayerId);
    if (!nextPlayerId) return;
    hand.currentTurnPlayerId = nextPlayerId;
    this.resetTurnDeadline(room);
  }

  advanceTurnAfterPlayer(room, playerId, now = Date.now()) {
    const hand = room.hand;
    if (!hand || hand.activePlayerIds.length === 0) return;
    const nextPlayerId = this.findNextActivePlayerId(room, playerId);
    if (!nextPlayerId) return;
    hand.currentTurnPlayerId = nextPlayerId;
    this.resetTurnDeadline(room, now);
  }

  findNextActivePlayerId(room, playerId) {
    const hand = room.hand;
    if (!hand || hand.activePlayerIds.length === 0) return '';
    const activeIds = new Set(hand.activePlayerIds);
    const ring = this.createSeatRing(room);
    if (!ring.length) return hand.activePlayerIds[0] || '';

    const start = ring.find((node) => node.playerId === playerId)
      || ring.find((node) => node.playerId === hand.currentTurnPlayerId)
      || ring[0];
    let node = start.next;

    for (let steps = 0; steps < ring.length; steps += 1) {
      if (activeIds.has(node.playerId)) return node.playerId;
      node = node.next;
    }

    return '';
  }

  createSeatRing(room) {
    const ring = room.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({ playerId: player.id, next: null }));

    ring.forEach((node, index) => {
      node.next = ring[(index + 1) % ring.length] || null;
    });

    return ring;
  }

  expireCurrentTurn(roomId, now = Date.now()) {
    const room = this.requireRoom(roomId);
    const hand = room.hand;
    if (room.status !== 'playing' || !hand || !hand.currentTurnPlayerId) return null;
    if (!hand.turnDeadlineAt || now < hand.turnDeadlineAt) return null;

    const playerId = hand.currentTurnPlayerId;
    if (!hand.activePlayerIds.includes(playerId)) {
      this.advanceTurn(room);
      return null;
    }

    hand.foldedPlayerIds.push(playerId);
    hand.activePlayerIds = hand.activePlayerIds.filter((id) => id !== playerId);
    hand.actionLog.push({ type: 'timeout_fold', playerId, at: now });
    this.clearPendingPeekIfParticipant(hand, playerId);

    if (hand.activePlayerIds.length === 1) {
      this.settleHand(room, 'action_timeout');
    } else {
      this.advanceTurnAfterPlayer(room, playerId, now);
    }

    return { room, playerId };
  }

  resetTurnDeadline(room, now = Date.now()) {
    if (!room.hand) return;
    room.hand.turnStartedAt = now;
    room.hand.turnDeadlineAt = this.getTurnDeadline(room, now);
  }

  getTurnDeadline(room, now = Date.now()) {
    return now + room.config.actionTimeoutSeconds * 1000;
  }

  getOpeningTurnPlayerId(room, playerIds) {
    const winnerId = room.lastSettlement && Array.isArray(room.lastSettlement.winnerIds)
      ? room.lastSettlement.winnerIds[0]
      : null;
    const winnerIndex = winnerId ? playerIds.indexOf(winnerId) : -1;
    if (winnerIndex === -1) return playerIds[0];
    return playerIds[(winnerIndex + 1) % playerIds.length];
  }

  serializeRoom(room, viewerId) {
    return {
      id: room.id,
      hostId: room.hostId,
      status: room.status,
      config: room.config,
      players: room.players.map((player) => ({
        id: player.id,
        nickname: player.nickname,
        avatarUrl: player.avatarUrl,
        coins: player.coins,
        connected: player.connected,
        seat: player.seat,
        isHost: player.id === room.hostId,
      })),
      avatarOptions: this.serializeAvatarOptions(room, viewerId),
      hand: room.hand ? this.serializeHand(room, viewerId) : null,
      lastSettlement: room.lastSettlement,
      finalSettlement: room.finalSettlement,
    };
  }

  serializeHand(room, viewerId) {
    const hand = room.hand;
    return {
      id: hand.id,
      pot: hand.pot,
      currentTurnPlayerId: hand.currentTurnPlayerId,
      turnStartedAt: hand.turnStartedAt,
      turnDeadlineAt: hand.turnDeadlineAt,
      activePlayerIds: hand.activePlayerIds.slice(),
      dealtPlayerIds: this.getDealtPlayerIds(hand),
      foldedPlayerIds: hand.foldedPlayerIds.slice(),
      viewedPlayerIds: hand.viewedPlayerIds.slice(),
      peekUsedPlayerIds: hand.peekUsedPlayerIds.slice(),
      pendingPeekRequest: hand.pendingPeekRequest ? Object.assign({}, hand.pendingPeekRequest) : null,
      currentBet: hand.currentBet ? Object.assign({}, hand.currentBet) : null,
      legalBetOptions: viewerId ? this.getLegalBetOptions(room, viewerId) : [],
      canShowdown: [1, 2].includes(hand.activePlayerIds.length),
      myCards: viewerId && hand.viewedPlayerIds.includes(viewerId)
        ? hand.hands[viewerId].map(publicCard)
        : null,
    };
  }

  serializeAvatarOptions(room, viewerId) {
    return ZODIAC_AVATAR_KEYS.map((key) => {
      const selectedBy = room.players.find((player) => player.avatarUrl === key);
      return {
        key,
        disabled: Boolean(selectedBy && selectedBy.id !== viewerId),
        selectedByPlayerId: selectedBy ? selectedBy.id : '',
      };
    });
  }
}

module.exports = RoomManager;

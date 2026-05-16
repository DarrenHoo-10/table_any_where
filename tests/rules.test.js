const test = require('node:test');
const assert = require('node:assert/strict');
const RoomManager = require('../server/roomManager');
const {
  MAX_COINS,
  compareHands,
  createDeck,
  evaluateHand,
  getDeckCount,
  normalizeConfig,
} = require('../server/rules');

const C = (rank, suit = 'S') => ({ rank, suit, value: rank === 'A' ? 14 : rank === 'K' ? 13 : rank === 'Q' ? 12 : rank === 'J' ? 11 : Number(rank) });
const TEST_AVATARS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig'];

function selectMissingAvatars(manager, room) {
  room.players.forEach((player, index) => {
    if (!player.avatarUrl) manager.selectAvatar(room.id, player.id, TEST_AVATARS[index]);
  });
}

function startReadyHand(manager, room, playerId, now) {
  selectMissingAvatars(manager, room);
  return manager.startHand(room.id, playerId, now);
}

test('uses one deck for up to 8 players and two decks after that', () => {
  assert.equal(getDeckCount(8), 1);
  assert.equal(getDeckCount(9), 2);
  assert.equal(createDeck(8).length, 52);
  assert.equal(createDeck(12).length, 104);
});

test('evaluates core three-card hand types', () => {
  assert.equal(evaluateHand([C('A'), C('A', 'H'), C('A', 'D')]).type, 'triple');
  assert.equal(evaluateHand([C('5'), C('6'), C('7')]).type, 'straight_flush');
  assert.equal(evaluateHand([C('A'), C('2'), C('3')]).type, 'straight_flush');
  assert.equal(evaluateHand([C('5'), C('6', 'H'), C('7')]).type, 'tractor');
  assert.equal(evaluateHand([C('2'), C('8'), C('K')]).type, 'flush');
  assert.equal(evaluateHand([C('9'), C('9', 'H'), C('K')]).type, 'pair');
  assert.equal(evaluateHand([C('2'), C('8', 'H'), C('K')]).type, 'high_card');
});

test('compares evaluated hands and treats A-2-3 as the lowest straight', () => {
  const wheel = evaluateHand([C('A', 'S'), C('2', 'H'), C('3', 'D')]);
  const fourHigh = evaluateHand([C('2', 'S'), C('3', 'H'), C('4', 'D')]);

  assert.equal(compareHands(wheel, fourHigh), -1);
  assert.equal(compareHands(fourHigh, wheel), 1);
});

test('mode ranking changes between zha jing hua and tractor mode', () => {
  const flush = [C('2'), C('8'), C('K')];
  const tractor = [C('5'), C('6', 'H'), C('7')];
  const straightFlush = [C('5'), C('6'), C('7')];

  assert.equal(compareHands(flush, tractor, 'zha_jing_hua'), 1);
  assert.equal(compareHands(flush, tractor, 'tractor'), -1);
  assert.equal(compareHands(tractor, straightFlush, 'tractor'), 1);
});

test('normalizes room defaults conservatively', () => {
  assert.deepEqual(normalizeConfig({}).betOptions, [5, 10, 20, 50]);
  assert.deepEqual(normalizeConfig({ betOptions: [0, -1, 'bad'] }).betOptions, [5, 10, 20, 50]);
  assert.equal(normalizeConfig({}).maxPlayers, 12);
  assert.equal(normalizeConfig({ maxPlayers: 2, playerCount: 3 }).maxPlayers, 12);
  assert.equal(normalizeConfig({}).initialCoins, 1000);
  assert.equal(normalizeConfig({ initialCoins: 3000 }).initialCoins, 3000);
  assert.equal(normalizeConfig({}).baseBet, 5);
  assert.equal(normalizeConfig({}).bonus, 50);
  assert.equal(normalizeConfig({ bonus: 0 }).bonus, 0);
  assert.equal(normalizeConfig({}).peekCost, 10);
  assert.equal(normalizeConfig({ peekCost: 0 }).peekCost, 0);
  assert.equal(normalizeConfig({}).actionTimeoutSeconds, 180);
  assert.equal(normalizeConfig({ actionTimeoutSeconds: 45 }).actionTimeoutSeconds, 45);
  assert.equal(normalizeConfig({ actionTimeoutSeconds: 0 }).actionTimeoutSeconds, 10);
});

test('rooms no longer use custom player caps and reject only the thirteenth player', () => {
  const manager = new RoomManager();
  const { room } = manager.createRoom({ nickname: 'Host' }, { maxPlayers: 2 });

  for (let index = 2; index <= 12; index += 1) {
    manager.joinRoom(room.id, { nickname: `P${index}` });
  }

  assert.equal(room.players.length, 12);
  assert.throws(
    () => manager.joinRoom(room.id, { nickname: 'P13' }),
    /房间人数已满/
  );
});

test('single player can start, view cards, and settle a solo hand', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'Solo' }, { baseBet: 5 });
  manager.selectAvatar(room.id, host.id, 'rat');

  manager.startHand(room.id, host.id);

  assert.equal(room.status, 'playing');
  assert.equal(room.players.length, 1);
  assert.equal(room.hand.activePlayerIds.length, 1);
  assert.equal(room.hand.pot, 5);
  assert.equal(host.coins, 995);
  assert.equal(manager.serializeHand(room, host.id).canShowdown, true);

  const viewResult = manager.handleAction(room.id, host.id, { type: 'view_self' });
  assert.equal(viewResult.privateCards.length, 3);

  manager.handleAction(room.id, host.id, { type: 'showdown' });

  assert.equal(room.status, 'between_hands');
  assert.deepEqual(room.lastSettlement.winnerIds, [host.id]);
  assert.deepEqual(room.lastSettlement.revealedPlayerIds, [host.id]);
  assert.equal(host.coins, 1000);
});

test('room initial coins apply to host, joined players, and only non-positive support coins', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom(
    { nickname: 'A' },
    { maxPlayers: 2, initialCoins: 3000, bonus: 0 }
  );
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  assert.equal(host.coins, 3000);
  assert.equal(guest.coins, 3000);

  startReadyHand(manager, room, host.id);
  room.hand.hands[host.id] = [C('A'), C('A', 'H'), C('A', 'D')];
  room.hand.hands[guest.id] = [C('2'), C('3', 'H'), C('4', 'D')];
  guest.coins = 0;
  manager.handleAction(room.id, host.id, { type: 'showdown', amount: 5 });

  assert.equal(room.lastSettlement.hadNegative, true);
  assert.deepEqual(room.lastSettlement.supportCoinPlayerIds, [guest.id]);
  assert.equal(host.coins, 3005);
  assert.equal(guest.coins, 3000);
});

test('players select unique zodiac avatars after entering the room', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A', avatarUrl: 'rat' }, { maxPlayers: 3 });
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B', avatarUrl: 'rat' });
  const { player: tail } = manager.joinRoom(room.id, { nickname: 'C' });

  assert.equal(host.avatarUrl, '');
  assert.equal(guest.avatarUrl, '');
  assert.equal(tail.avatarUrl, '');
  assert.throws(() => manager.startHand(room.id, host.id), /请选择头像/);

  manager.selectAvatar(room.id, host.id, 'rat');
  assert.throws(() => manager.selectAvatar(room.id, guest.id, 'rat'), /头像已被选择/);
  manager.selectAvatar(room.id, guest.id, 'ox');

  const hostView = manager.serializeRoom(room, host.id);
  const usedRat = hostView.avatarOptions.find((option) => option.key === 'rat');
  const usedOx = hostView.avatarOptions.find((option) => option.key === 'ox');
  const openTiger = hostView.avatarOptions.find((option) => option.key === 'tiger');
  assert.equal(usedRat.disabled, false);
  assert.equal(usedRat.selectedByPlayerId, host.id);
  assert.equal(usedOx.disabled, true);
  assert.equal(usedOx.selectedByPlayerId, guest.id);
  assert.equal(openTiger.disabled, false);

  manager.selectAvatar(room.id, tail.id, 'tiger');
  startReadyHand(manager, room, host.id);
  assert.equal(room.status, 'playing');
});

test('players can join during a hand and wait until the next hand', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 3, bonus: 50 });
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  manager.selectAvatar(room.id, host.id, 'rat');
  manager.selectAvatar(room.id, guest.id, 'ox');
  manager.startHand(room.id, host.id);
  room.hand.hands[host.id] = [C('A'), C('A', 'H'), C('A', 'D')];
  room.hand.hands[guest.id] = [C('2'), C('3', 'H'), C('4', 'D')];

  const { player: late } = manager.joinRoom(room.id, { nickname: 'C' });
  assert.equal(room.status, 'playing');
  assert.equal(room.hand.activePlayerIds.includes(late.id), false);
  assert.equal(room.hand.hands[late.id], undefined);
  assert.equal(late.coins, 1000);
  manager.selectAvatar(room.id, late.id, 'tiger');
  assert.throws(() => manager.handleAction(room.id, late.id, { type: 'view_self' }), /弃牌后不能看牌/);

  manager.handleAction(room.id, host.id, { type: 'showdown', amount: 5 });

  assert.equal(room.status, 'between_hands');
  assert.equal(room.lastSettlement.hands[late.id], undefined);
  assert.equal(room.lastSettlement.afterCoins[late.id], 1000);
  assert.equal(room.lastSettlement.bonusTransfers.some((transfer) => transfer.fromPlayerId === late.id), false);

  manager.startHand(room.id, host.id);
  assert.equal(room.hand.activePlayerIds.includes(late.id), true);
  assert.equal(room.hand.hands[late.id].length, 3);
});

test('mirror-card requires consent, compares hands, and reveals the result to both players', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: '房主' }, { maxPlayers: 3 });
  const { player: guest } = manager.joinRoom(room.id, { nickname: '客人' });
  const { player: tail } = manager.joinRoom(room.id, { nickname: '后手' });

  startReadyHand(manager, room, host.id);
  room.hand.hands[host.id] = [C('A'), C('A', 'H'), C('A', 'D')];
  room.hand.hands[guest.id] = [C('2'), C('3', 'H'), C('4', 'D')];
  room.hand.hands[tail.id] = [C('K'), C('K', 'H'), C('K', 'D')];
  assert.equal(room.hand.pot, 15);
  assert.throws(
    () => manager.handleAction(room.id, host.id, { type: 'peek_player', targetPlayerId: guest.id }),
    /看牌后才可以照牌/
  );
  manager.handleAction(room.id, host.id, { type: 'view_self' });
  assert.throws(
    () => manager.handleAction(room.id, host.id, { type: 'peek_player', targetPlayerId: guest.id }),
    /已经看过自己的牌/
  );
  manager.handleAction(room.id, guest.id, { type: 'view_self' });

  const before = host.coins;
  const request = manager.handleAction(room.id, host.id, { type: 'peek_player', targetPlayerId: guest.id });
  assert.equal(host.coins, before);
  assert.equal(room.hand.pot, 15);
  assert.equal(request.pendingPeekRequest.requesterId, host.id);
  assert.equal(request.pendingPeekRequest.targetPlayerId, guest.id);
  assert.equal(request.pendingPeekRequest.cost, 5);
  assert.equal(typeof request.pendingPeekRequest.requestedAt, 'number');
  assert.throws(
    () => manager.handleAction(room.id, host.id, { type: 'bet', amount: 5 }),
    /正在等待照牌回应/
  );

  const result = manager.handleAction(room.id, guest.id, { type: 'respond_peek_player', accepted: true });
  assert.equal(before - host.coins, 5);
  assert.equal(room.hand.pot, 20);
  assert.equal(room.hand.pendingPeekRequest, null);
  assert.deepEqual(result.privateMessages.map((item) => item.privateTo).sort(), [guest.id, host.id].sort());
  assert.deepEqual(result.privateMessages.find((item) => item.privateTo === host.id).peekTargetPlayerId, guest.id);
  assert.deepEqual(result.privateMessages.find((item) => item.privateTo === guest.id).peekTargetPlayerId, host.id);
  assert.equal(result.privateMessages.every((item) => item.winnerId === host.id && item.loserId === guest.id), true);
  assert.deepEqual(result.privateMessages.find((item) => item.privateTo === host.id).participantHands[host.id], [
    { suit: 'S', rank: 'A', value: 14 },
    { suit: 'H', rank: 'A', value: 14 },
    { suit: 'D', rank: 'A', value: 14 },
  ]);
  assert.deepEqual(result.privateMessages.find((item) => item.privateTo === guest.id).participantHands[guest.id], [
    { suit: 'S', rank: '2', value: 2 },
    { suit: 'H', rank: '3', value: 3 },
    { suit: 'D', rank: '4', value: 4 },
  ]);
  assert.equal(room.hand.activePlayerIds.includes(guest.id), false);
  assert.equal(room.hand.foldedPlayerIds.includes(guest.id), true);
  assert.equal(room.hand.currentTurnPlayerId, tail.id);
});

test('mirror-card refusal clears the request without charging or consuming the peek', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: '房主' }, { maxPlayers: 2 });
  const { player: guest } = manager.joinRoom(room.id, { nickname: '客人' });

  startReadyHand(manager, room, host.id);
  manager.handleAction(room.id, host.id, { type: 'view_self' });
  manager.handleAction(room.id, guest.id, { type: 'view_self' });
  const before = host.coins;

  manager.handleAction(room.id, host.id, { type: 'peek_player', targetPlayerId: guest.id });
  const result = manager.handleAction(room.id, guest.id, { type: 'respond_peek_player', accepted: false });

  assert.equal(result.accepted, false);
  assert.equal(host.coins, before);
  assert.equal(room.hand.pot, 10);
  assert.equal(room.hand.pendingPeekRequest, null);
  assert.deepEqual(room.hand.peekUsedPlayerIds, []);
  assert.equal(room.hand.currentTurnPlayerId, host.id);
});

test('bet options enforce open and blind relative call levels', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom(
    { nickname: 'A' },
    { maxPlayers: 2, betOptions: [5, 10, 20, 50] }
  );
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  startReadyHand(manager, room, host.id);
  manager.handleAction(room.id, host.id, { type: 'view_self' });
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 20 });

  assert.throws(
    () => manager.handleAction(room.id, guest.id, { type: 'bet', amount: 5 }),
    /低于当前需要/
  );

  const guestBefore = guest.coins;
  manager.handleAction(room.id, guest.id, { type: 'bet', amount: 10 });
  assert.equal(guestBefore - guest.coins, 10);

  assert.throws(
    () => manager.handleAction(room.id, host.id, { type: 'bet', amount: 10 }),
    /低于当前需要/
  );

  const hostBefore = host.coins;
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 20 });
  assert.equal(hostBefore - host.coins, 20);
});

test('open and blind calls use adjacent bet option levels', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom(
    { nickname: 'A' },
    { maxPlayers: 2, betOptions: [5, 10, 20, 50] }
  );
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  startReadyHand(manager, room, host.id);
  manager.handleAction(room.id, host.id, { type: 'view_self' });
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 50 });

  assert.throws(
    () => manager.handleAction(room.id, guest.id, { type: 'bet', amount: 10 }),
    /低于当前需要/
  );

  const guestBefore = guest.coins;
  manager.handleAction(room.id, guest.id, { type: 'bet', amount: 20 });
  assert.equal(guestBefore - guest.coins, 20);

  assert.throws(
    () => manager.handleAction(room.id, host.id, { type: 'bet', amount: 20 }),
    /低于当前需要/
  );

  const hostBefore = host.coins;
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 50 });
  assert.equal(hostBefore - host.coins, 50);
});

test('blind players cannot choose a level above the highest callable open level', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom(
    { nickname: 'A' },
    { maxPlayers: 2, betOptions: [5, 10, 20, 50] }
  );

  manager.joinRoom(room.id, { nickname: 'B' });
  startReadyHand(manager, room, host.id);

  assert.throws(
    () => manager.handleAction(room.id, host.id, { type: 'bet', amount: 50 }),
    /闷牌下注不能超过/
  );

  const before = host.coins;
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 20 });
  assert.equal(before - host.coins, 20);
});

test('showdown defaults to current legal bet and reveals both contenders', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom(
    { nickname: 'A' },
    { maxPlayers: 2, bonus: 0, betOptions: [5, 10, 20, 50] }
  );
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  startReadyHand(manager, room, host.id);
  room.hand.hands[host.id] = [C('A'), C('A', 'H'), C('A', 'D')];
  room.hand.hands[guest.id] = [C('2'), C('3', 'H'), C('4', 'D')];
  manager.handleAction(room.id, host.id, { type: 'view_self' });
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 50 });

  const guestBefore = guest.coins;
  manager.handleAction(room.id, guest.id, { type: 'showdown' });

  assert.equal(guestBefore - guest.coins, 20);
  assert.equal(room.status, 'between_hands');
  assert.deepEqual(room.lastSettlement.revealedPlayerIds.sort(), [guest.id, host.id].sort());
  assert.equal(room.lastSettlement.hands[host.id].cards.length, 3);
  assert.equal(room.lastSettlement.hands[guest.id].cards.length, 3);
});

test('serialized hand only reveals viewed cards and copies mutable arrays', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 2 });
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  startReadyHand(manager, room, host.id);
  manager.handleAction(room.id, host.id, { type: 'view_self' });

  const hostView = manager.serializeHand(room, host.id);
  const guestView = manager.serializeHand(room, guest.id);

  assert.equal(hostView.myCards.length, 3);
  assert.equal(guestView.myCards, null);

  hostView.activePlayerIds.pop();
  assert.equal(room.hand.activePlayerIds.length, 2);
});

test('active player leaving during a hand folds and settles when one player remains', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 2, bonus: 0 });
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  startReadyHand(manager, room, host.id);
  const pot = room.hand.pot;
  const hostBefore = host.coins;

  const updatedRoom = manager.leaveRoom(guest.id);

  assert.equal(updatedRoom.status, 'between_hands');
  assert.equal(updatedRoom.lastSettlement.reason, 'player_left');
  assert.deepEqual(updatedRoom.lastSettlement.winnerIds, [host.id]);
  assert.equal(host.coins, hostBefore + pot);
});

test('current player leaving advances turn to the next active seat', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 3, bonus: 0 });
  const { player: middle } = manager.joinRoom(room.id, { nickname: 'B' });
  const { player: tail } = manager.joinRoom(room.id, { nickname: 'C' });

  startReadyHand(manager, room, host.id);
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 5 });
  assert.equal(room.hand.currentTurnPlayerId, middle.id);

  const updatedRoom = manager.leaveRoom(middle.id);

  assert.equal(updatedRoom.status, 'playing');
  assert.equal(updatedRoom.hand.currentTurnPlayerId, tail.id);
});

test('folding the second player in a three-player hand advances to the third player', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 3, bonus: 0 });
  const { player: middle } = manager.joinRoom(room.id, { nickname: 'B' });
  const { player: tail } = manager.joinRoom(room.id, { nickname: 'C' });

  startReadyHand(manager, room, host.id);
  manager.handleAction(room.id, host.id, { type: 'bet', amount: 5 });
  assert.equal(room.hand.currentTurnPlayerId, middle.id);

  manager.handleAction(room.id, middle.id, { type: 'fold' });

  assert.equal(room.status, 'playing');
  assert.equal(room.hand.currentTurnPlayerId, tail.id);
  assert.deepEqual(room.hand.activePlayerIds, [host.id, tail.id]);
});

test('fold turn advancement follows the seat ring instead of active id array order', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 3, bonus: 0 });
  const { player: middle } = manager.joinRoom(room.id, { nickname: 'B' });
  const { player: tail } = manager.joinRoom(room.id, { nickname: 'C' });

  startReadyHand(manager, room, host.id);
  room.hand.currentTurnPlayerId = middle.id;
  room.hand.activePlayerIds = [middle.id, host.id, tail.id];

  manager.handleAction(room.id, middle.id, { type: 'fold' });

  assert.equal(room.hand.currentTurnPlayerId, tail.id);
});

test('expired turns fold the current player and advance to the next active seat', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom(
    { nickname: 'A' },
    { maxPlayers: 3, bonus: 0, actionTimeoutSeconds: 10 }
  );
  const { player: middle } = manager.joinRoom(room.id, { nickname: 'B' });
  const { player: tail } = manager.joinRoom(room.id, { nickname: 'C' });

  startReadyHand(manager, room, host.id, 1000);
  assert.equal(room.hand.currentTurnPlayerId, host.id);
  assert.equal(room.hand.turnDeadlineAt, 11000);

  const result = manager.expireCurrentTurn(room.id, 11001);

  assert.equal(result.playerId, host.id);
  assert.equal(room.status, 'playing');
  assert.equal(room.hand.currentTurnPlayerId, middle.id);
  assert.equal(room.hand.turnDeadlineAt, 21001);
  assert.deepEqual(room.hand.foldedPlayerIds, [host.id]);
  assert.deepEqual(room.hand.activePlayerIds, [middle.id, tail.id]);
});

test('new hands start from the player after the previous winner in join order', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 3, bonus: 0 });
  const { player: middle } = manager.joinRoom(room.id, { nickname: 'B' });
  const { player: tail } = manager.joinRoom(room.id, { nickname: 'C' });

  startReadyHand(manager, room, host.id);
  room.hand.hands[host.id] = [C('2'), C('3', 'H'), C('4', 'D')];
  room.hand.hands[middle.id] = [C('A'), C('A', 'H'), C('A', 'D')];
  room.hand.hands[tail.id] = [C('K'), C('K', 'H'), C('K', 'D')];
  manager.handleAction(room.id, host.id, { type: 'fold' });
  manager.handleAction(room.id, middle.id, { type: 'showdown', amount: 5 });
  assert.deepEqual(room.lastSettlement.winnerIds, [middle.id]);

  startReadyHand(manager, room, host.id);

  assert.equal(room.hand.currentTurnPlayerId, tail.id);
});

test('settlement adds support coins for negative balances and triggers final settlement over cap', () => {
  const manager = new RoomManager();
  const { room, player: host } = manager.createRoom({ nickname: 'A' }, { maxPlayers: 2, bonus: 50 });
  const { player: guest } = manager.joinRoom(room.id, { nickname: 'B' });

  startReadyHand(manager, room, host.id);
  room.hand.hands[host.id] = [C('A'), C('A', 'H'), C('A', 'D')];
  room.hand.hands[guest.id] = [C('2'), C('3', 'H'), C('4', 'D')];
  guest.coins = -20;
  manager.handleAction(room.id, host.id, { type: 'showdown', amount: 5 });

  assert.equal(room.lastSettlement.hadNegative, true);
  assert.equal(room.status, 'between_hands');

  room.status = 'lobby';
  room.finalSettlement = null;
  host.coins = MAX_COINS - 10;
  guest.coins = 1000;
  startReadyHand(manager, room, host.id);
  room.hand.hands[host.id] = [C('K'), C('K', 'H'), C('K', 'D')];
  room.hand.hands[guest.id] = [C('2'), C('3', 'H'), C('4', 'D')];
  manager.handleAction(room.id, guest.id, { type: 'showdown', amount: 20 });

  assert.equal(room.status, 'finished');
  assert.equal(room.finalSettlement.reason, 'coin_cap_exceeded');
  assert.equal(room.finalSettlement.ranking[0].principal, 1000);
  assert.equal(
    room.finalSettlement.ranking[0].profitLoss,
    room.finalSettlement.ranking[0].coins - room.finalSettlement.ranking[0].principal
  );
});

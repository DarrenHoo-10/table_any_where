const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const RoomManager = require('./roomManager');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const manager = new RoomManager();
const playerSockets = new Map();
const roomTurnTimers = new Map();
const disconnectKickTimers = new Map();
const DISCONNECT_KICK_DELAY_MS = Number(process.env.DISCONNECT_KICK_DELAY_MS || 5000);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
};

const NO_STORE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.webmanifest']);

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    try {
      handleMessage(socket, JSON.parse(raw.toString()));
    } catch (error) {
      send(socket, 'error', { message: error.message || '请求失败。' });
    }
  });

  socket.on('close', () => {
    if (!socket.playerId) return;
    const playerId = socket.playerId;
    if (playerSockets.get(playerId) !== socket) return;
    playerSockets.delete(playerId);
    const room = manager.markDisconnected(playerId);
    if (room) broadcastRoom(room, 'room_state');
    scheduleDisconnectedPlayerKick(playerId);
  });
});

function handleMessage(socket, message) {
  const type = message.type;
  const payload = message.payload || {};

  if (type === 'create_room') {
    detachSocketFromCurrentRoom(socket);
    const result = manager.createRoom(payload.player, payload.config || payload);
    bindSocket(socket, result.room.id, result.player);
    send(socket, 'welcome', {
      roomId: result.room.id,
      playerId: result.player.id,
      playerToken: result.player.token,
    });
    broadcastRoom(result.room, 'room_state');
    return;
  }

  if (type === 'join_room') {
    detachSocketFromCurrentRoom(socket);
    const result = manager.joinRoom(payload.roomId, payload.player || payload);
    bindSocket(socket, result.room.id, result.player);
    send(socket, 'welcome', {
      roomId: result.room.id,
      playerId: result.player.id,
      playerToken: result.player.token,
    });
    broadcastRoom(result.room, 'room_state');
    return;
  }

  if (type === 'reconnect') {
    detachSocketFromCurrentRoom(socket);
    const result = manager.reconnect(payload.roomId, payload.playerId, payload.playerToken);
    bindSocket(socket, result.room.id, result.player);
    send(socket, 'welcome', {
      roomId: result.room.id,
      playerId: result.player.id,
      playerToken: result.player.token,
    });
    broadcastRoom(result.room, 'room_state');
    return;
  }

  requireIdentity(socket);

  if (type === 'start_hand') {
    const room = manager.startHand(socket.roomId, socket.playerId);
    broadcastRoom(room, 'room_state');
    broadcastRoom(room, 'hand_state');
    scheduleRoomTurnTimer(room);
    return;
  }

  if (type === 'select_avatar') {
    const result = manager.selectAvatar(socket.roomId, socket.playerId, payload.avatarUrl || payload.avatarKey);
    broadcastRoom(result.room, 'room_state');
    return;
  }

  if (type === 'finish_game') {
    const room = manager.requireRoom(socket.roomId);
    const settlement = manager.finishGame(socket.roomId, socket.playerId);
    clearRoomTurnTimer(room.id);
    broadcastRoom(room, 'final_settlement', settlement);
    broadcastRoom(room, 'room_state');
    return;
  }

  if (type === 'action') {
    const result = manager.handleAction(socket.roomId, socket.playerId, payload);
    const room = result.room;
    broadcastRoom(room, 'action_result', {
      playerId: socket.playerId,
      action: result.action || payload.type,
      targetPlayerId: result.targetPlayerId ?? payload.targetPlayerId,
      requesterId: result.requesterId,
      accepted: result.accepted,
      winnerId: result.winnerId,
      loserId: result.loserId,
      amount: result.amount ?? payload.amount,
      pot: room.hand ? room.hand.pot : 0,
      coinsByPlayerId: getCoinsByPlayerId(room),
    });
    if (Array.isArray(result.privateMessages)) {
      result.privateMessages.forEach((message) => {
        sendToPlayer(message.privateTo, 'private_cards', {
          cards: message.privateCards,
          targetPlayerId: message.peekResultTargetPlayerId || message.peekTargetPlayerId || message.privateTo,
          cardTargetPlayerId: message.peekTargetPlayerId || message.privateTo,
          requesterId: message.peekRequesterId,
          winnerId: message.winnerId,
          loserId: message.loserId,
          participantHands: message.participantHands,
          participants: message.participants,
        });
      });
    }
    if (result.privateTo) {
      sendToPlayer(result.privateTo, 'private_cards', {
        cards: result.privateCards,
        targetPlayerId: result.peekTargetPlayerId || result.privateTo,
      });
    }
    if (room.lastSettlement) broadcastRoom(room, 'hand_settlement', room.lastSettlement);
    if (room.finalSettlement) broadcastRoom(room, 'final_settlement', room.finalSettlement);
    broadcastRoom(room, 'room_state');
    if (room.hand) broadcastRoom(room, 'hand_state');
    scheduleRoomTurnTimer(room);
    return;
  }

  if (type === 'leave_room') {
    const previousRoomId = socket.roomId;
    const room = manager.leaveRoom(socket.playerId);
    playerSockets.delete(socket.playerId);
    socket.playerId = null;
    socket.roomId = null;
    if (room) broadcastRoom(room, 'room_state');
    if (room) {
      if (room.hand) broadcastRoom(room, 'hand_state');
      scheduleRoomTurnTimer(room);
    } else {
      clearRoomTurnTimer(previousRoomId);
    }
    send(socket, 'left_room', {});
    return;
  }

  throw new Error('未知消息类型。');
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (indexError, indexData) => {
        if (indexError) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'content-type': MIME_TYPES['.html'], 'cache-control': getCacheControl('.html') });
        res.end(indexData);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME_TYPES[ext] || 'application/octet-stream',
      'cache-control': getCacheControl(ext),
    });
    res.end(data);
  });
}

function getCacheControl(ext) {
  return NO_STORE_EXTENSIONS.has(ext) ? 'no-store' : 'public, max-age=3600';
}

function bindSocket(socket, roomId, player) {
  if (socket.playerId && socket.playerId !== player.id) playerSockets.delete(socket.playerId);
  clearDisconnectedPlayerKick(player.id);
  socket.roomId = roomId;
  socket.playerId = player.id;
  player.connected = true;
  playerSockets.set(player.id, socket);
}

function detachSocketFromCurrentRoom(socket) {
  if (!socket.playerId) return;
  const playerId = socket.playerId;
  const previousRoomId = socket.roomId;
  playerSockets.delete(playerId);
  clearDisconnectedPlayerKick(playerId);
  socket.playerId = null;
  socket.roomId = null;

  const room = manager.leaveRoom(playerId);
  if (room) {
    broadcastRoom(room, 'room_state');
    if (room.hand) broadcastRoom(room, 'hand_state');
    scheduleRoomTurnTimer(room);
  } else {
    clearRoomTurnTimer(previousRoomId);
  }
}

function requireIdentity(socket) {
  if (!socket.roomId || !socket.playerId) throw new Error('请先创建或加入房间。');
}

function broadcastRoom(room, type, payload) {
  room.players.forEach((player) => {
    const socket = playerSockets.get(player.id);
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    send(socket, type, payload || manager.serializeRoom(room, player.id));
  });
}

function sendToPlayer(playerId, type, payload) {
  const socket = playerSockets.get(playerId);
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  send(socket, type, payload);
}

function send(socket, type, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type, payload }));
}

function scheduleRoomTurnTimer(room) {
  clearRoomTurnTimer(room.id);
  if (!room.hand || room.status !== 'playing' || !room.hand.turnDeadlineAt) return;

  const delay = Math.max(0, room.hand.turnDeadlineAt - Date.now());
  const timer = setTimeout(() => handleTurnTimeout(room.id), delay);
  roomTurnTimers.set(room.id, timer);
}

function clearRoomTurnTimer(roomId) {
  if (!roomId || !roomTurnTimers.has(roomId)) return;
  clearTimeout(roomTurnTimers.get(roomId));
  roomTurnTimers.delete(roomId);
}

function scheduleDisconnectedPlayerKick(playerId) {
  clearDisconnectedPlayerKick(playerId);
  const timer = setTimeout(() => handleDisconnectedPlayerKick(playerId), DISCONNECT_KICK_DELAY_MS);
  disconnectKickTimers.set(playerId, timer);
}

function clearDisconnectedPlayerKick(playerId) {
  if (!disconnectKickTimers.has(playerId)) return;
  clearTimeout(disconnectKickTimers.get(playerId));
  disconnectKickTimers.delete(playerId);
}

function handleDisconnectedPlayerKick(playerId) {
  disconnectKickTimers.delete(playerId);

  let result = null;
  try {
    result = manager.kickDisconnectedPlayer(playerId);
  } catch (error) {
    return;
  }

  if (!result) return;
  const room = result.room;
  if (!room) {
    clearRoomTurnTimer(result.roomId);
    return;
  }

  if (room.lastSettlement) broadcastRoom(room, 'hand_settlement', room.lastSettlement);
  if (room.finalSettlement) broadcastRoom(room, 'final_settlement', room.finalSettlement);
  broadcastRoom(room, 'room_state');
  if (room.hand) broadcastRoom(room, 'hand_state');
  scheduleRoomTurnTimer(room);
}

function handleTurnTimeout(roomId) {
  roomTurnTimers.delete(roomId);

  let result = null;
  try {
    result = manager.expireCurrentTurn(roomId);
  } catch (error) {
    return;
  }

  if (!result) {
    const room = manager.rooms.get(roomId);
    if (room) scheduleRoomTurnTimer(room);
    return;
  }

  const room = result.room;
  broadcastRoom(room, 'action_result', {
    playerId: result.playerId,
    action: 'timeout_fold',
    pot: room.hand ? room.hand.pot : 0,
    coinsByPlayerId: getCoinsByPlayerId(room),
  });
  if (room.lastSettlement) broadcastRoom(room, 'hand_settlement', room.lastSettlement);
  if (room.finalSettlement) broadcastRoom(room, 'final_settlement', room.finalSettlement);
  broadcastRoom(room, 'room_state');
  if (room.hand) broadcastRoom(room, 'hand_state');
  scheduleRoomTurnTimer(room);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'content-type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(data));
}

function getCoinsByPlayerId(room) {
  return Object.fromEntries(room.players.map((player) => [player.id, player.coins]));
}

httpServer.listen(PORT, HOST, () => {
  console.log(`Straight Flush web game listening on http://${HOST}:${PORT}`);
});

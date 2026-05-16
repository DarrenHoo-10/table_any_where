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

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

const NO_STORE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json']);

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
    playerSockets.delete(socket.playerId);
    const room = manager.markDisconnected(socket.playerId);
    if (room) broadcastRoom(room, 'room_state');
  });
});

function handleMessage(socket, message) {
  const type = message.type;
  const payload = message.payload || {};

  if (type === 'create_room') {
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
    return;
  }

  if (type === 'finish_game') {
    const room = manager.requireRoom(socket.roomId);
    const settlement = manager.finishGame(socket.roomId, socket.playerId);
    broadcastRoom(room, 'final_settlement', settlement);
    broadcastRoom(room, 'room_state');
    return;
  }

  if (type === 'action') {
    const result = manager.handleAction(socket.roomId, socket.playerId, payload);
    const room = result.room;
    broadcastRoom(room, 'action_result', {
      playerId: socket.playerId,
      action: payload.type,
      targetPlayerId: payload.targetPlayerId,
      amount: payload.amount,
    });
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
    return;
  }

  if (type === 'leave_room') {
    const room = manager.leaveRoom(socket.playerId);
    playerSockets.delete(socket.playerId);
    socket.playerId = null;
    socket.roomId = null;
    if (room) broadcastRoom(room, 'room_state');
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
  socket.roomId = roomId;
  socket.playerId = player.id;
  player.connected = true;
  playerSockets.set(player.id, socket);
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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'content-type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(data));
}

httpServer.listen(PORT, HOST, () => {
  console.log(`Straight Flush web game listening on http://${HOST}:${PORT}`);
});

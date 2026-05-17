const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const WebSocket = require('ws');

test('creating a new room on an already-bound socket removes the old room player', async () => {
  const port = await getAvailablePort();
  const server = await startServer(port);

  try {
    const host = await connectClient(port);
    const guest = await connectClient(port);
    const observer = await connectClient(port);

    const firstWelcomePromise = waitForMessage(host, 'welcome');
    const firstRoomPromise = waitForRoomState(host, null);
    send(host, 'create_room', { player: { nickname: 'Host' } });
    const hostWelcome = await firstWelcomePromise;
    const oldRoomId = hostWelcome.payload.roomId;
    await firstRoomPromise;

    const guestWelcomePromise = waitForMessage(guest, 'welcome');
    const guestRoomPromise = waitForRoomState(guest, oldRoomId, (room) => room.players.length === 2);
    send(guest, 'join_room', { roomId: oldRoomId, player: { nickname: 'Guest' } });
    await guestWelcomePromise;
    await guestRoomPromise;

    const secondWelcomePromise = waitForMessage(host, 'welcome', (payload) => payload.roomId !== oldRoomId);
    const secondRoomPromise = waitForRoomState(
      host,
      null,
      (room) => room.id !== oldRoomId && room.players.map((player) => player.nickname).join(',') === 'Host Again'
    );
    send(host, 'create_room', { player: { nickname: 'Host Again' } });
    await secondWelcomePromise;
    await secondRoomPromise;

    const observerWelcomePromise = waitForMessage(observer, 'welcome');
    const observerRoomPromise = waitForRoomState(observer, oldRoomId, (room) => room.players.length >= 2);
    send(observer, 'join_room', { roomId: oldRoomId, player: { nickname: 'Observer' } });
    await observerWelcomePromise;
    const oldRoom = await observerRoomPromise;

    assert.deepEqual(oldRoom.players.map((player) => player.nickname), ['Guest', 'Observer']);

    closeClient(host);
    closeClient(guest);
    closeClient(observer);
  } finally {
    await stopServer(server);
  }
});

function send(socket, type, payload = {}) {
  socket.send(JSON.stringify({ type, payload }));
}

function closeClient(socket) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}

async function connectClient(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function waitForMessage(socket, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2000);

    const onMessage = (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      if (message.type !== type || !predicate(message.payload || {})) return;
      cleanup();
      resolve(message);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    }

    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

async function waitForRoomState(socket, roomId, predicate = () => true) {
  const message = await waitForMessage(socket, 'room_state', (room) => {
    if (roomId && room.id !== roomId) return false;
    return predicate(room);
  });
  return message.payload;
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.once('error', reject);
  });
}

function startServer(port) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: Object.assign({}, process.env, {
      HOST: '127.0.0.1',
      PORT: String(port),
      DISCONNECT_KICK_DELAY_MS: '50',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error(`Timed out starting server. Output: ${output}`));
    }, 2000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (!output.includes(`127.0.0.1:${port}`)) return;
      cleanup();
      resolve(child);
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Server exited early with code ${code}. Output: ${output}`));
    };

    function cleanup() {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    child.kill();
  });
}

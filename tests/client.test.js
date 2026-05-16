const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

test('create room form no longer exposes custom player count', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

  assert.equal(html.includes('maxPlayersInput'), false);
  assert.equal(html.includes('for="maxPlayersInput"'), false);
  assert.equal(appJs.includes('maxPlayersInput'), false);
  assert.equal(appJs.includes('maxPlayers:'), false);
});

test('playing cards avoid gold border styling', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const cardBlocks = [
    '.playing-card',
    '.playing-card::before',
    '.card-center',
    '.playing-card.is-back',
    '.playing-card.is-back::before',
    '.playing-card.is-back::after',
    '.card-back-emblem',
  ].map((selector) => getCssBlock(css, selector)).join('\n');

  assert.equal(cardBlocks.includes('rgba(181, 138, 47'), false);
  assert.equal(cardBlocks.includes('rgba(245, 215, 125'), false);
  assert.equal(cardBlocks.includes('var(--gold)'), false);
  assert.equal(cardBlocks.includes('border: 1px'), false);
  assert.equal(cardBlocks.includes('border-color'), false);

  const drawCardBlock = getFunctionBlock(tableScene, 'drawCard');
  const createCardMeshBlock = getMethodBlock(tableScene, 'createCardMesh');
  assert.equal(drawCardBlock.includes('#f5d77d'), false);
  assert.equal(drawCardBlock.includes('#d1a954'), false);
  assert.equal(drawCardBlock.includes('rgba(245, 215, 125'), false);
  assert.equal(drawCardBlock.includes('ctx.stroke'), false);
  assert.equal(createCardMeshBlock.includes('0xf5d77d'), false);
  assert.equal(createCardMeshBlock.includes('0xd1a954'), false);
  assert.equal(createCardMeshBlock.includes('0xd8d0c2'), false);
  assert.match(createCardMeshBlock, /opacity: 0,/);
  assert.match(createCardMeshBlock, /depthWrite: false,/);
});

test('3d table starts from a lower pulled-back camera angle', () => {
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');

  assert.match(tableScene, /const DEFAULT_CAMERA_PITCH = 0\.62;/);
  assert.match(tableScene, /const DEFAULT_CAMERA_DISTANCE = 8\.9;/);
  assert.match(tableScene, /const DEFAULT_CAMERA_TARGET_Y = 0\.04;/);
  assert.match(tableScene, /this\.pitch = DEFAULT_CAMERA_PITCH;/);
  assert.match(tableScene, /this\.distance = DEFAULT_CAMERA_DISTANCE;/);
  assert.match(tableScene, /new THREE\.Vector3\(0, DEFAULT_CAMERA_TARGET_Y, 0\)/);
});

test('3d playing cards do not cast or receive shadows', () => {
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const renderCardsBlock = getMethodBlock(tableScene, 'renderCards');

  assert.match(renderCardsBlock, /mesh\.castShadow = false;/);
  assert.match(renderCardsBlock, /mesh\.receiveShadow = false;/);
  assert.equal(renderCardsBlock.includes('mesh.castShadow = true'), false);
  assert.equal(renderCardsBlock.includes('mesh.receiveShadow = true'), false);
});

test('3d chip stacks do not add synthetic shadow disks', () => {
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const createChipStackBlock = getMethodBlock(tableScene, 'createChipStack');

  assert.equal(createChipStackBlock.includes('CircleGeometry'), false);
  assert.equal(createChipStackBlock.includes('opacity: 0.16'), false);
});

test('viewed 3d cards stand upright facing the player avatar and keep full brightness', () => {
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const renderCardsBlock = getMethodBlock(tableScene, 'renderCards');
  const createCardMeshBlock = getMethodBlock(tableScene, 'createCardMesh');

  assert.match(tableScene, /const VIEWED_CARD_SPACING = 0\.18;/);
  assert.match(renderCardsBlock, /if \(viewed\) \{/);
  assert.match(renderCardsBlock, /const spread = viewed \? \(1 - cardIndex\) \* VIEWED_CARD_SPACING : \(cardIndex - 1\) \* TABLE_CARD_SPACING;/);
  assert.match(renderCardsBlock, /mesh\.renderOrder = viewed \? 20 \+ cardIndex : 0;/);
  assert.match(renderCardsBlock, /mesh\.rotation\.set\(0, angle, 0\);/);
  assert.equal(renderCardsBlock.includes('VIEWED_CARD_LAYER_OFFSET'), false);
  assert.equal(renderCardsBlock.includes('cardBillboardQuaternion'), false);
  assert.equal(tableScene.includes('function cardFrontQuaternion'), false);
  assert.equal(renderCardsBlock.includes('viewed ? screenRight : tangent'), false);
  assert.match(createCardMeshBlock, /new THREE\.MeshBasicMaterial/);
  assert.equal(createCardMeshBlock.includes('new THREE.MeshStandardMaterial'), false);
  assert.match(createCardMeshBlock, /depthWrite: false,/);
  assert.match(createCardMeshBlock, /toneMapped: false,/);
  assert.match(tableScene, /texture\.colorSpace = THREE\.SRGBColorSpace;/);
  assert.equal(renderCardsBlock.includes('showSideCorners'), false);
});

test('3d card faces keep side corners hidden for overlapped hands', () => {
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const drawCardBlock = getFunctionBlock(tableScene, 'drawCard');

  assert.equal(drawCardBlock.includes('showSideCorners'), false);
  assert.equal(drawCardBlock.includes('drawCardCorner(ctx, rank, suit, width - 45, 64, 0);'), false);
  assert.equal(drawCardBlock.includes('drawCardCorner(ctx, rank, suit, 45, height - 48, Math.PI);'), false);
});

test('turn clock updates timer text without rebuilding the 3d scene', () => {
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const renderHandBlock = getFunctionBlock(appJs, 'renderHand');
  const renderTurnClockBlock = getFunctionBlock(appJs, 'renderTurnClock');

  assert.match(renderHandBlock, /renderCurrentTurnText\(hand\);/);
  assert.match(renderTurnClockBlock, /renderCurrentTurnText\(safeHand\(\)\);/);
  assert.equal(renderTurnClockBlock.includes('renderHand('), false);
  assert.equal(renderTurnClockBlock.includes('renderTableScene3d'), false);
});

test('new room requests clear stale saved sessions and ignore stale room states', () => {
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const createRoomBlock = getEventHandlerBlock(appJs, "els.createRoomBtn.addEventListener('click'");
  const joinRoomBlock = getEventHandlerBlock(appJs, "els.joinRoomBtn.addEventListener('click'");
  const backHomeBlock = getEventHandlerBlock(appJs, "els.backHomeBtn.addEventListener('click'");
  const roomStateBlock = getMessageBranchBlock(appJs, "message.type === 'room_state'");

  assert.match(createRoomBlock, /beginNewRoomRequest\('正在创建房间\.\.\.'\);/);
  assert.match(joinRoomBlock, /beginNewRoomRequest\('正在加入房间\.\.\.'\);/);
  assert.match(backHomeBlock, /clearRoomSession\('已返回首页'\);/);
  assert.match(roomStateBlock, /if \(!shouldAcceptRoomState\(payload\)\) return;/);
  assert.match(appJs, /function shouldAcceptRoomState\(room\)/);
});

function getCssBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return '';
  const end = css.indexOf('\n}', start);
  return end === -1 ? css.slice(start) : css.slice(start, end + 2);
}

function getFunctionBlock(source, name) {
  return getBraceBlock(source, source.indexOf(`function ${name}`));
}

function getMethodBlock(source, name) {
  return getBraceBlock(source, source.indexOf(`  ${name}(`));
}

function getEventHandlerBlock(source, marker) {
  return getBraceBlock(source, source.indexOf(marker));
}

function getMessageBranchBlock(source, marker) {
  return getBraceBlock(source, source.indexOf(marker));
}

function getBraceBlock(source, start) {
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

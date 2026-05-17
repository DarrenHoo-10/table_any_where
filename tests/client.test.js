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

test('visual table theme defaults to classic and keeps red wood tray optional', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const configJs = fs.readFileSync(path.join(PUBLIC_DIR, 'config.js'), 'utf8');
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

  assert.match(html, /<script src="\/config\.js"><\/script>[\s\S]*<script type="module" src="\/tableScene3d\.js"><\/script>/);
  assert.match(configJs, /tableTheme: 'classic'/);
  assert.match(configJs, /red_wood_tray/);
  assert.match(appJs, /const TABLE_THEME_KEYS = new Set\(\['classic', 'red_wood_tray'\]\);/);
  assert.match(appJs, /document\.body\.dataset\.tableTheme = getTableTheme\(\);/);
  assert.match(appJs, /tableTheme: getTableTheme\(\)/);
  assert.match(tableScene, /const TABLE_THEME_KEYS = new Set\(\['classic', 'red_wood_tray'\]\);/);
  assert.match(tableScene, /this\.tableTheme = normalizeTableTheme/);
  assert.match(css, /body\[data-table-theme="red_wood_tray"\] \.table-scene-3d/);
  assert.match(css, /body\.is-in-room\[data-table-theme="red_wood_tray"\] \.table-view/);
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

test('3d table keeps classic green table as default and supports red felt wooden tray theme', () => {
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const installSceneBlock = getMethodBlock(tableScene, 'installScene');
  const classicSceneBlock = getMethodBlock(tableScene, 'installClassicScene');
  const redWoodSceneBlock = getMethodBlock(tableScene, 'installRedWoodTrayScene');

  assert.match(installSceneBlock, /this\.tableTheme === 'red_wood_tray'/);
  assert.match(installSceneBlock, /this\.installRedWoodTrayScene\(\)/);
  assert.match(installSceneBlock, /this\.installClassicScene\(\)/);
  assert.match(classicSceneBlock, /new THREE\.CylinderGeometry\(2\.76, 2\.76, 0\.035, 128\)/);
  assert.match(classicSceneBlock, /color: 0x176846/);
  assert.match(classicSceneBlock, /new THREE\.TorusGeometry\(2\.91, 0\.09, 18, 128\)/);
  assert.match(redWoodSceneBlock, /createWoodTexture\(\)/);
  assert.match(redWoodSceneBlock, /createRedFeltTexture\(\)/);
  assert.match(redWoodSceneBlock, /createForestBackdropTexture\(\)/);
  assert.match(redWoodSceneBlock, /new THREE\.BoxGeometry\(8\.65, 0\.36, 5\.35\)/);
  assert.match(redWoodSceneBlock, /new THREE\.BoxGeometry\(7\.28, 0\.055, 4\.14\)/);
  assert.match(redWoodSceneBlock, /new THREE\.BoxGeometry\(\.\.\.part\.size\)/);
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
  const renderPotBlock = getMethodBlock(tableScene, 'renderPot');

  assert.equal(createChipStackBlock.includes('CircleGeometry'), false);
  assert.equal(createChipStackBlock.includes('opacity: 0.16'), false);
  assert.match(createChipStackBlock, /chip\.castShadow = false;/);
  assert.match(createChipStackBlock, /chip\.receiveShadow = false;/);
  assert.equal(createChipStackBlock.includes('chip.castShadow = true'), false);
  assert.equal(createChipStackBlock.includes('chip.receiveShadow = true'), false);
  assert.match(tableScene, /const TABLETOP_PROP_Y = 0\.3;/);
  assert.match(renderPotBlock, /chips\.position\.set\(0\.62, TABLETOP_PROP_Y, -0\.12\);/);
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
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const renderHandBlock = getFunctionBlock(appJs, 'renderHand');
  const renderTurnClockBlock = getFunctionBlock(appJs, 'renderTurnClock');
  const renderTableTurnTimerBlock = getFunctionBlock(appJs, 'renderTableTurnTimer');
  const installTimerDeviceBlock = getMethodBlock(tableScene, 'installTurnTimerDevice');
  const updateTurnTimerBlock = getMethodBlock(tableScene, 'updateTurnTimer');
  const drawTurnTimerDeviceBlock = getMethodBlock(tableScene, 'drawTurnTimerDevice');
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

  assert.match(html, /id="tableTurnTimer"/);
  assert.equal(html.includes('id="tableHudCards"'), false);
  assert.equal(appJs.includes('renderHudCards'), false);
  assert.equal(appJs.includes('tableHudCards'), false);
  assert.match(renderHandBlock, /renderCurrentTurnText\(hand\);/);
  assert.match(renderHandBlock, /renderTableTurnTimer\(hand\);/);
  assert.match(renderTableTurnTimerBlock, /els\.tableTurnTimer\.hidden = !visible;/);
  assert.match(renderTableTurnTimerBlock, /state\.tableScene3d\.updateTurnTimer\(timer, isWarning, visible\);/);
  assert.match(renderTableTurnTimerBlock, /<strong>\$\{timer\}<\/strong>/);
  assert.equal(renderTableTurnTimerBlock.includes('escapeHtml(current.nickname)'), false);
  assert.match(renderTurnClockBlock, /const hand = safeHand\(\);/);
  assert.match(renderTurnClockBlock, /renderCurrentTurnText\(hand\);/);
  assert.match(renderTurnClockBlock, /renderTableTurnTimer\(hand\);/);
  assert.equal(renderTurnClockBlock.includes('warnTurnCountdown'), false);
  assert.equal(appJs.includes('warnTurnCountdown'), false);
  assert.equal(appJs.includes('playTurnWarningSound'), false);
  assert.equal(appJs.includes('AudioContext'), false);
  assert.equal(appJs.includes('turnWarningAudioContext'), false);
  assert.equal(appJs.includes('turnWarningKey'), false);
  assert.match(css, /\.table-turn-timer/);
  assert.equal(css.includes('.table-card-hud'), false);
  assert.equal(css.includes('.table-hud-cards'), false);
  assert.match(css, /\.table-turn-timer \{[\s\S]*clip-path: inset\(50%\);/);
  assert.equal(css.includes('.table-turn-timer::after'), false);
  assert.equal(css.includes('left: 50%;\n  top: 43%;'), false);
  assert.match(tableScene, /const DECK_SCALE = 1\.08;/);
  assert.match(tableScene, /const TABLETOP_PROP_Y = 0\.3;/);
  assert.match(tableScene, /const TABLE_TIMER_SIZE = \{ width: CARD_SIZE\.height \* DECK_SCALE, height: CARD_SIZE\.width \* DECK_SCALE \};/);
  assert.match(tableScene, /const TABLE_TIMER_POSITION = new THREE\.Vector3\(-0\.58, TABLETOP_PROP_Y, -0\.22\);/);
  assert.match(tableScene, /this\.deck\.position\.set\(0, TABLETOP_PROP_Y, -0\.18\);/);
  assert.match(tableScene, /this\.deck\.scale\.set\(DECK_SCALE, DECK_SCALE, DECK_SCALE\);/);
  assert.match(tableScene, /this\.updateTurnTimer\(\s*formatSceneTurnTimer\(hand\.turnDeadlineAt\),/);
  assert.match(installTimerDeviceBlock, /new THREE\.PlaneGeometry\(TABLE_TIMER_SIZE\.width, TABLE_TIMER_SIZE\.height\)/);
  assert.match(installTimerDeviceBlock, /this\.turnTimerGroup\.rotation\.set\(-Math\.PI \/ 2, 0, Math\.PI \/ 2 - 0\.12\);/);
  assert.match(updateTurnTimerBlock, /this\.turnTimerGroup\.visible = shouldShow;/);
  assert.match(drawTurnTimerDeviceBlock, /ctx\.font = '900 72px "Courier New", monospace';/);
  assert.match(tableScene, /function formatSceneTurnTimer\(deadlineAt\)/);
  assert.equal(renderTurnClockBlock.includes('renderHand('), false);
  assert.equal(renderTurnClockBlock.includes('renderTableScene3d'), false);
});

test('3d table marks current and next turn players with css arrows', () => {
  const tableScene = fs.readFileSync(path.join(PUBLIC_DIR, 'tableScene3d.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');
  const renderPlayersBlock = getMethodBlock(tableScene, 'renderPlayers');
  const positionLabelsBlock = getMethodBlock(tableScene, 'positionLabels');

  assert.match(renderPlayersBlock, /const nextTurnPlayerId = findNextTurnPlayerId\(players, hand, activeIds\);/);
  assert.match(renderPlayersBlock, /label\.classList\.toggle\('is-turn', player\.id === hand\.currentTurnPlayerId\);/);
  assert.match(renderPlayersBlock, /label\.classList\.toggle\('is-next-turn', player\.id === nextTurnPlayerId\);/);
  assert.equal(renderPlayersBlock.includes('addTurnArrow'), false);
  assert.match(tableScene, /function findNextTurnPlayerId\(players, hand, activeIds\)/);
  assert.equal(tableScene.includes('turnArrowsGroup'), false);
  assert.equal(tableScene.includes('loadTurnArrowAssets'), false);
  assert.equal(tableScene.includes('parseObjGeometry'), false);
  assert.equal(tableScene.includes('parseMtlColor'), false);
  assert.match(css, /\.table-seat-label::before/);
  assert.match(css, /\.table-seat-label\.is-turn::before,/);
  assert.match(css, /\.table-seat-label\.is-next-turn::before/);
  assert.match(css, /border-top-color: #39d35c;/);
  assert.match(positionLabelsBlock, /document\.body\.classList\.contains\('is-in-room'\)/);
  assert.match(positionLabelsBlock, /Math\.min\(190, rect\.height \* 0\.28\)/);
});

test('new room requests clear stale saved sessions and ignore stale room states', () => {
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const createRoomBlock = getEventHandlerBlock(appJs, "els.createRoomBtn.addEventListener('click'");
  const joinRoomBlock = getEventHandlerBlock(appJs, "els.joinRoomBtn.addEventListener('click'");
  const backHomeBlock = getEventHandlerBlock(appJs, "els.backHomeBtn.addEventListener('click'");
  const welcomeBlock = getMessageBranchBlock(appJs, "message.type === 'welcome'");
  const roomStateBlock = getMessageBranchBlock(appJs, "message.type === 'room_state'");
  const leaveRoomBlock = getFunctionBlock(appJs, 'leaveRoom');
  const beginNewRoomRequestBlock = getFunctionBlock(appJs, 'beginNewRoomRequest');
  const leftRoomBlock = getMessageBranchBlock(appJs, "message.type === 'left_room'");

  assert.match(createRoomBlock, /beginNewRoomRequest\('正在创建房间\.\.\.'\);/);
  assert.match(joinRoomBlock, /beginNewRoomRequest\('正在加入房间\.\.\.'\);/);
  assert.match(backHomeBlock, /clearRoomSession\('已返回首页'\);/);
  assert.match(leaveRoomBlock, /clearRoomSession\('已离开房间', \{ keepLeaving: true \}\);/);
  assert.match(leaveRoomBlock, /state\.leaveReloadTimer = setTimeout\(reloadAfterLeavingRoom, 1500\);/);
  assert.match(leftRoomBlock, /clearRoomSession\('已离开房间'\);/);
  assert.match(leftRoomBlock, /reloadAfterLeavingRoom\(\);/);
  assert.match(appJs, /if \(!options\.keepLeaving\) state\.leavingRoom = false;/);
  assert.match(appJs, /localStorage\.removeItem\('lastRoomSession'\);/);
  assert.match(appJs, /function reloadAfterLeavingRoom\(\)/);
  assert.match(appJs, /window\.location\.reload\(\);/);
  assert.match(beginNewRoomRequestBlock, /clearRoomSession\(status\);[\s\S]*state\.leavingRoom = false;/);
  assert.match(welcomeBlock, /state\.status = '已进入房间';/);
  assert.match(roomStateBlock, /if \(!shouldAcceptRoomState\(payload\)\) return;/);
  assert.match(appJs, /function shouldAcceptRoomState\(room\)/);
});

test('final settlement ranking shows principal, balance, and colored profit loss', () => {
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');
  const renderFinalBlock = getFunctionBlock(appJs, 'renderFinal');

  assert.match(renderFinalBlock, /本金/);
  assert.match(renderFinalBlock, /余额/);
  assert.match(renderFinalBlock, /盈亏/);
  assert.match(renderFinalBlock, /formatProfitLoss\(profitLoss\)/);
  assert.match(appJs, /const sign = number >= 0 \? '\+' : '-';/);
  assert.match(css, /--profit: #e45b5b;/);
  assert.match(css, /--loss: #39b879;/);
  assert.match(css, /\.ranking-list b\.is-profit/);
  assert.match(css, /\.ranking-list b\.is-loss/);
});

test('final settlement ranking keeps the player column left aligned', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');
  const firstColumnBlock = getCssBlock(css, '.ranking-row > :first-child');

  assert.match(firstColumnBlock, /text-align: left;/);
});

test('action and settlement messages apply coin snapshots before room refresh', () => {
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const actionResultBlock = getMessageBranchBlock(appJs, "message.type === 'action_result'");
  const settlementBlock = getMessageBranchBlock(appJs, "message.type === 'hand_settlement'");

  assert.match(actionResultBlock, /applyCoinSnapshot\(payload\);/);
  assert.match(settlementBlock, /applySettlementCoins\(payload\);/);
  assert.match(appJs, /function applyCoinSnapshot\(payload = \{\}\)/);
  assert.match(appJs, /coinsByPlayerId/);
  assert.match(appJs, /function applySettlementCoins\(settlement = \{\}\)/);
  assert.match(appJs, /afterCoins/);
});

test('room info can collapse and portrait rotate hint can be dismissed', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

  assert.match(html, /id="roomPanelToggleBtn"/);
  assert.match(html, /id="dismissRotateHintBtn"/);
  assert.match(appJs, /roomPanelCollapsed: false/);
  assert.match(appJs, /state\.roomPanelCollapsed = false;/);
  assert.equal(appJs.includes("localStorage.setItem('roomPanelCollapsed'"), false);
  assert.match(appJs, /rotateHintDismissed: localStorage\.getItem\('rotateHintDismissed'\) === 'true'/);
  assert.match(appJs, /function toggleRoomPanel\(\)/);
  assert.match(appJs, /function renderRotateHint\(\)/);
  assert.match(appJs, /state\.roomPanelCollapsed\) \{/);
  assert.match(appJs, /展开房间信息/);
  assert.match(css, /\.room-panel\.is-collapsed > div/);
  assert.match(css, /body\.is-in-room \.room-panel\.is-collapsed \{[\s\S]*width: 54px;/);
  assert.match(css, /body\.is-in-room \.room-panel\.is-collapsed \.room-panel-toggle/);
  assert.match(css, /\.rotate-phone-hint\[hidden\]/);
});

test('mobile room view uses smaller seat and avatar icons', () => {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'styles.css'), 'utf8');

  assert.match(css, /body\.is-in-room \.table-seat-label img/);
  assert.match(css, /width: 28px;/);
  assert.match(css, /\.player-avatar,/);
  assert.match(css, /width: 38px;/);
  assert.match(css, /\.avatar-option/);
  assert.match(css, /min-height: 78px;/);
});

test('mid-hand joiners are shown as waiting instead of folded', () => {
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const renderPlayersBlock = getFunctionBlock(appJs, 'renderPlayers');
  const renderActionsBlock = getFunctionBlock(appJs, 'renderActions');
  const renderAvatarPickerBlock = getFunctionBlock(appJs, 'renderAvatarPicker');

  assert.match(renderPlayersBlock, /等待下手/);
  assert.match(renderActionsBlock, /你正在旁观，等待下一手/);
  assert.match(renderAvatarPickerBlock, /state\.room\?\.status !== 'lobby' && Boolean\(selectedKey\)/);
});

test('peek action uses target and result modals with auto-close notification', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
  const renderActionsBlock = getFunctionBlock(appJs, 'renderActions');
  const handleMessageBlock = getFunctionBlock(appJs, 'handleMessage');

  assert.match(html, /id="peekTargetModal"/);
  assert.match(html, /id="peekResultModal"/);
  assert.match(renderActionsBlock, /actionButton\('照牌'/);
  assert.equal(renderActionsBlock.includes('`照 ${target ? target.nickname'), false);
  assert.match(renderActionsBlock, /看牌后才可以照牌/);
  assert.match(renderActionsBlock, /activeIds\.length > 2/);
  assert.match(handleMessageBlock, /state\.peekResultModalOpen = true;/);
  assert.match(appJs, /function renderPeekTargetModal\(\)/);
  assert.match(appJs, /function renderPeekResultModal\(\)/);
  assert.match(appJs, /function findPeekResultPlayer\(result, playerId\)/);
  assert.match(appJs, /if \(activeIds\.length <= 2\) return \[\];/);
  assert.match(appJs, /setTimeout\(\(\) => \{/);
  assert.match(appJs, /}, 5000\);/);
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

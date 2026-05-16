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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CARD_ROOT = path.join(ROOT, 'public', 'assets', 'cards', 'ornate-v1');
const CHAIR_PATH = path.join(ROOT, 'public', 'assets', 'models', 'armchair-01-game.glb');
const HOME_HERO_PATH = path.join(ROOT, 'public', 'design-assets', 'home-hero-friends-v1.webp');
const HOME_COVERS_PATH = path.join(ROOT, 'public', 'design-assets', 'home-game-covers-v1.webp');

function readGlbJson(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.toString('utf8', 0, 4), 'glTF');
  const jsonLength = buffer.readUInt32LE(12);
  return {
    bytes: buffer.length,
    json: JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength).replace(/\0+$/g, '').trimEnd()),
  };
}

test('runtime card deck contains the 52 standard WebP faces and one back', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CARD_ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema, 'straight-flush-card-assets/v1');
  assert.equal(manifest.cards.length, 52);
  assert.deepEqual(manifest.textureSize, [512, 717]);

  const expected = new Set();
  for (const suit of ['S', 'H', 'D', 'C']) {
    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']) {
      expected.add(`${rank}${suit}`);
    }
  }
  assert.deepEqual(new Set(manifest.cards.map((card) => card.id)), expected);

  for (const card of manifest.cards) {
    const file = fs.readFileSync(path.join(CARD_ROOT, card.front));
    assert.equal(file.toString('ascii', 0, 4), 'RIFF');
    assert.equal(file.toString('ascii', 8, 12), 'WEBP');
  }
  const back = fs.readFileSync(path.join(CARD_ROOT, manifest.defaultBack));
  assert.equal(back.toString('ascii', 8, 12), 'WEBP');

  const totalBytes = fs.readdirSync(path.join(CARD_ROOT, 'front'))
    .reduce((sum, filename) => sum + fs.statSync(path.join(CARD_ROOT, 'front', filename)).size, back.length);
  assert.ok(totalBytes < 3 * 1024 * 1024, `runtime deck is too large: ${totalBytes} bytes`);
});

test('runtime chair is a lightweight WebP GLB within the browser budget', () => {
  const { bytes, json } = readGlbJson(CHAIR_PATH);
  const triangleCount = (json.meshes || []).reduce((meshTotal, mesh) => (
    meshTotal + (mesh.primitives || []).reduce((primitiveTotal, primitive) => {
      const count = json.accessors?.[primitive.indices]?.count || 0;
      return primitiveTotal + Math.floor(count / 3);
    }, 0)
  ), 0);

  assert.ok(bytes < 3 * 1024 * 1024, `runtime chair is too large: ${bytes} bytes`);
  assert.ok(triangleCount <= 35000, `runtime chair has too many triangles: ${triangleCount}`);
  assert.ok((json.images || []).every((image) => image.mimeType === 'image/webp'));
  assert.ok((json.extensionsUsed || []).includes('EXT_texture_webp'));
});

test('home page artwork uses lightweight WebP assets within the browser budget', () => {
  const hero = fs.readFileSync(HOME_HERO_PATH);
  const covers = fs.readFileSync(HOME_COVERS_PATH);

  assert.equal(hero.toString('ascii', 0, 4), 'RIFF');
  assert.equal(hero.toString('ascii', 8, 12), 'WEBP');
  assert.equal(covers.toString('ascii', 0, 4), 'RIFF');
  assert.equal(covers.toString('ascii', 8, 12), 'WEBP');
  assert.ok(hero.length <= 450 * 1024, 'home hero is too large: ' + hero.length + ' bytes');
  assert.ok(covers.length <= 180 * 1024, 'home covers are too large: ' + covers.length + ' bytes');
});

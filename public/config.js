const PUBLIC_BASE_PATH = window.location.pathname.includes('/games/')
  ? window.location.pathname.split('/games/')[0]
  : window.location.pathname.replace(/\/+$/g, '');

window.SFG_CONFIG = {
  publicBasePath: PUBLIC_BASE_PATH,
  visual: {
    // Use "red_wood_tray" for the red felt tray, or "zha_room" for the 3D Zha Jin Hua room.
    // Keep "classic" as the default production table.
    tableTheme: 'classic',
    // Keep the current procedural round table by default. The GLB asset is staged for later previews.
    tableAsset: 'procedural_zha_round',
    // Runtime-ready derivatives built from the asset management platform's source files.
    chairAssetUrl: `${PUBLIC_BASE_PATH}/assets/models/armchair-01-game.glb`,
    cardAssetBaseUrl: `${PUBLIC_BASE_PATH}/assets/cards/ornate-v1`,
  },
};

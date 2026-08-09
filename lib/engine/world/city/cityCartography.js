// ═══════════════════════════════════════════════════════
//  CARTOGRAPHY — drawing the city from the city's own functions
//
//  The map is not an asset. It calls exactly the same `shoreDistance`,
//  `districtAt` and `roadAt` the world is built from, so it cannot
//  disagree with the world: if the map shows a bridge, there is a
//  bridge, because the same expression decided both.
//
//  Ground is rastered — one sample per map pixel, at whatever
//  resolution the caller can afford — and the road network is drawn as
//  lines on top, because a five-metre street is invisible at any zoom
//  where the whole city fits on screen and has to be exaggerated to
//  mean anything.
//
//  No Three.js in here. This runs in a 2D canvas inside React.
// ═══════════════════════════════════════════════════════
import {
  BRIDGES,
  MOTORWAY_GRID,
  ROADS,
  SUPERBLOCK,
  WORLD_HALF,
} from './cityConfig.js';

export const MAP_PALETTE = {
  sea: '#12354a',
  seaDeep: '#0b2434',
  shore: '#2f6d86',
  motorway: '#f0c04a',
  boulevard: '#e6e0d2',
  street: '#9aa0a8',
  grid: 'rgba(240, 236, 226, 0.14)',
  player: '#ff6a45',
  ink: '#0b0e13',
  label: '#efeadd',
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<import('./cityMap.js').createCityMap>} map
 * @param {object} view
 * @param {number} view.width       canvas pixels
 * @param {number} view.height
 * @param {number} view.centreX     world metres
 * @param {number} view.centreZ
 * @param {number} view.span        world metres across the canvas width
 * @param {number} [view.rotation]  world heading that points up. PI is north-up.
 * @param {number} [view.samples]   ground raster resolution across the width
 * @param {boolean} [view.streets]  draw the local grid as well as arterials
 * @param {boolean} [view.relief]   shade the hills. Costs two extra height samples.
 * @param {boolean} [view.labels]   write place names beside their markers
 * @param {Array} [view.places]
 * @param {{x:number,z:number,heading:number}} [view.player]
 */
export function drawCityMap(ctx, map, view) {
  const {
    width, height, centreX, centreZ, span,
    rotation = Math.PI,
    samples = 128,
    streets = false,
    relief = false,
    places = [],
    player = null,
    labels = false,
  } = view;

  const scale = width / span;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const toScreen = (x, z, out) => {
    const dx = x - centreX;
    const dz = z - centreZ;
    out.x = width / 2 + (dz * sin - dx * cos) * scale;
    out.y = height / 2 - (dx * sin + dz * cos) * scale;
    return out;
  };
  const toWorld = (sx, sy, out) => {
    const u = (sx - width / 2) / scale;
    const v = -(sy - height / 2) / scale;
    out.x = -cos * u - sin * v;
    out.z = sin * u - cos * v;
    out.x += centreX;
    out.z += centreZ;
    return out;
  };

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  rasterGround(ctx, map, { width, height, samples, relief, toWorld });
  drawRoads(ctx, map, { width, height, span, scale, streets, toScreen, toWorld });
  drawBridges(ctx, map, { scale, toScreen });
  if (places.length > 0) drawPlaces(ctx, map, places, { toScreen, labels });
  if (player) drawPlayer(ctx, player, { toScreen, rotation });
  ctx.restore();
}

// ── Ground ─────────────────────────────────────────────

function rasterGround(ctx, map, { width, height, samples, relief, toWorld }) {
  const cols = Math.max(16, Math.min(samples, width));
  const rows = Math.max(16, Math.round((cols * height) / width));
  const image = ctx.createImageData(cols, rows);
  const data = image.data;
  const point = { x: 0, z: 0 };
  const district = {};

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      toWorld(((col + 0.5) / cols) * width, ((row + 0.5) / rows) * height, point);
      const i = (row * cols + col) * 4;

      if (Math.abs(point.x) > WORLD_HALF || Math.abs(point.z) > WORLD_HALF) {
        writeHex(data, i, 0x0b0e13, 1);
        continue;
      }

      const shore = map.shoreDistance(point.x, point.z);
      if (shore <= 0) {
        // Deeper blue further from land, which is what makes the strait
        // read as a channel rather than as a blue stripe.
        const depth = Math.min(1, -shore / 900);
        writeMix(data, i, 0x2f6d86, 0x0b2434, depth);
        continue;
      }

      map.districtAt(point.x, point.z, district);
      let shade = 1;
      if (relief) {
        // Cheap hillshade from a north-west sun: the difference between
        // a flat green rectangle and something that reads as terrain.
        const h = map.heightAt(point.x, point.z);
        const hx = map.heightAt(point.x + 120, point.z);
        const hz = map.heightAt(point.x, point.z + 120);
        shade = 1 + Math.max(-0.45, Math.min(0.45, ((h - hx) + (h - hz)) * 0.02));
      }
      writeHex(data, i, district.spec.ground, shade);
    }
  }

  // Painted through an offscreen bitmap so the browser does the scaling
  // instead of us doing tens of thousands of fillRects.
  const buffer = document.createElement('canvas');
  buffer.width = cols;
  buffer.height = rows;
  buffer.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buffer, 0, 0, width, height);
}

function writeHex(data, i, hex, shade) {
  data[i] = Math.min(255, ((hex >> 16) & 0xff) * shade);
  data[i + 1] = Math.min(255, ((hex >> 8) & 0xff) * shade);
  data[i + 2] = Math.min(255, (hex & 0xff) * shade);
  data[i + 3] = 255;
}

function writeMix(data, i, a, b, t) {
  data[i] = ((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t;
  data[i + 1] = ((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t;
  data[i + 2] = (a & 0xff) + ((b & 0xff) - (a & 0xff)) * t;
  data[i + 3] = 255;
}

// ── Roads ──────────────────────────────────────────────

function drawRoads(ctx, map, { width, height, span, scale, streets, toScreen, toWorld }) {
  const corners = [
    toWorld(0, 0, {}), toWorld(width, 0, {}),
    toWorld(0, height, {}), toWorld(width, height, {}),
  ];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
  }

  const a = {};
  const b = {};
  const line = (x0, z0, x1, z1, colour, metres, minPixels) => {
    toScreen(x0, z0, a);
    toScreen(x1, z1, b);
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(minPixels, metres * scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  ctx.lineCap = 'round';

  // Boulevards first, so motorways draw over them at the crossings.
  if (span < 26000) {
    for (let X = ceilTo(minX, SUPERBLOCK); X <= maxX; X += SUPERBLOCK) {
      if (X % MOTORWAY_GRID === 0) continue;
      line(X, minZ, X, maxZ, MAP_PALETTE.boulevard, ROADS.boulevard.halfWidth * 2, 0.6);
    }
    for (let Z = ceilTo(minZ, SUPERBLOCK); Z <= maxZ; Z += SUPERBLOCK) {
      if (Z % MOTORWAY_GRID === 0) continue;
      line(minX, Z, maxX, Z, MAP_PALETTE.boulevard, ROADS.boulevard.halfWidth * 2, 0.6);
    }
  }

  if (streets && span < 3000) drawStreetGrids(ctx, map, { minX, maxX, minZ, maxZ, scale, toScreen });

  for (let X = ceilTo(minX, MOTORWAY_GRID); X <= maxX; X += MOTORWAY_GRID) {
    line(X, minZ, X, maxZ, MAP_PALETTE.motorway, ROADS.motorway.halfWidth * 2, 1.2);
  }
  for (let Z = ceilTo(minZ, MOTORWAY_GRID); Z <= maxZ; Z += MOTORWAY_GRID) {
    line(minX, Z, maxX, Z, MAP_PALETTE.motorway, ROADS.motorway.halfWidth * 2, 1.2);
  }
}

/**
 * The local grid, superblock by superblock. Each one is at its own
 * angle, and seeing that on the map is how a player learns that this
 * city is not a single grid stretched to the horizon.
 */
function drawStreetGrids(ctx, map, { minX, maxX, minZ, maxZ, scale, toScreen }) {
  const a = {};
  const b = {};
  ctx.strokeStyle = MAP_PALETTE.street;
  ctx.lineWidth = Math.max(0.5, ROADS.street.halfWidth * 2 * scale);

  for (let sx = Math.floor(minX / SUPERBLOCK); sx <= Math.floor(maxX / SUPERBLOCK); sx++) {
    for (let sz = Math.floor(minZ / SUPERBLOCK); sz <= Math.floor(maxZ / SUPERBLOCK); sz++) {
      const sb = map.superblockAtIndex(sx, sz, {});
      if (sb.spacing <= 0) continue;

      const reach = SUPERBLOCK / 2;
      const uDir = { x: sb.cos, z: sb.sin };
      const vDir = { x: -sb.sin, z: sb.cos };

      ctx.beginPath();
      for (let k = -Math.ceil(reach / sb.spacing); k <= reach / sb.spacing; k++) {
        const off = k * sb.spacing;
        if (Math.abs(off) > reach) continue;
        for (const [along, across] of [[vDir, uDir], [uDir, vDir]]) {
          const ox = sb.cx + across.x * off;
          const oz = sb.cz + across.z * off;
          toScreen(ox - along.x * reach, oz - along.z * reach, a);
          toScreen(ox + along.x * reach, oz + along.z * reach, b);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    }
  }
}

function drawBridges(ctx, map, { scale, toScreen }) {
  const a = {};
  const b = {};
  ctx.strokeStyle = MAP_PALETTE.motorway;
  ctx.lineWidth = Math.max(2, ROADS.motorway.halfWidth * 2.4 * scale);
  ctx.lineCap = 'butt';

  for (const bridge of BRIDGES) {
    const centre = map.straitCentre(bridge.z);
    const half = map.straitHalf(bridge.z) + bridge.approach * 0.4;
    toScreen(centre - half, bridge.z, a);
    toScreen(centre + half, bridge.z, b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// ── Annotation ─────────────────────────────────────────

function drawPlaces(ctx, map, places, { toScreen, labels }) {
  const point = {};
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (const place of places) {
    const x = place.x ?? map.straitCentre(place.z);
    toScreen(x, place.z, point);

    ctx.fillStyle = MAP_PALETTE.label;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = MAP_PALETTE.ink;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    if (!labels) continue;
    ctx.font = '600 10px "Barlow Condensed", system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(11, 14, 19, 0.85)';
    ctx.strokeText(place.name, point.x + 7, point.y);
    ctx.fillText(place.name, point.x + 7, point.y);
  }
}

function drawPlayer(ctx, player, { toScreen, rotation }) {
  const point = toScreen(player.x, player.z, {});
  // The marker is drawn pointing up, and the projection already turns
  // the world by `rotation` — so the arrow only has to make up the
  // difference. On a car-up minimap that difference is zero.
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(rotation - player.heading);
  ctx.fillStyle = MAP_PALETTE.player;
  ctx.strokeStyle = MAP_PALETTE.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5.5, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-5.5, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

const ceilTo = (value, step) => Math.ceil(value / step) * step;

// ═══════════════════════════════════════════════════════
//  TRACK MESH — the painted surfaces of the circuit
//
//  Asphalt with a crowned camber and a rubbered-in racing line,
//  white edge lines, kerbs only where there is an actual corner,
//  a run-off apron that turns to gravel and sponsor paint at the
//  braking zones, and the start/finish complex with painted grid
//  boxes. All of it reads from directly above, which is the point.
// ═══════════════════════════════════════════════════════
import * as THREE from 'three';
import { CORNER_CURVATURE, GRID_SIZE } from '../config.js';
import { clamp01, smoothstep, makeRng, lerp } from '../util.js';
import { buildSurface, findRanges, mergeGeometries } from './ribbon.js';
import { computeRacingLine } from './racingLine.js';

const Y_RUNOFF = 0.006;
const Y_ROAD = 0.02;
const Y_LINE = 0.055;
const Y_PAINT = 0.062;
const Y_KERB_IN = 0.035;
const Y_KERB_OUT = 0.15;

/** Alternating kerb block length, in metres along the track. */
const KERB_BLOCK = 2.6;

export function createTrackMesh(scene, circuit, theme, renderer) {
  const pal = theme.road;
  const halfW = circuit.halfWidth;
  const kerbW = circuit.kerbWidth;
  const runoffW = circuit.runoffWidth;
  const trackWidth = circuit.width;
  const disposables = [];
  const group = new THREE.Group();
  group.name = 'trackSurfaces';
  scene.add(group);

  const racingLine = computeRacingLine(circuit);

  const add = (geometry, material, { shadow = 'receive', order = 0 } = {}) => {
    if (!geometry) return null;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = shadow !== 'none';
    mesh.castShadow = shadow === 'both';
    mesh.renderOrder = order;
    group.add(mesh);
    disposables.push(geometry);
    return mesh;
  };

  // ── Shared colours ──
  const cAsphalt = new THREE.Color(pal.asphalt);
  const cWorn = new THREE.Color(pal.asphaltWorn);
  const cRubber = new THREE.Color(pal.asphalt).multiplyScalar(0.7);
  const cShoulder = new THREE.Color(pal.asphalt).multiplyScalar(0.6);
  const cLine = new THREE.Color(pal.line);
  const cKerbA = new THREE.Color(pal.kerbA);
  const cKerbB = new THREE.Color(pal.kerbB);
  const cRunoff = new THREE.Color(pal.runoff);
  const cRunoffAsphalt = new THREE.Color(pal.runoffAsphalt ?? pal.asphalt);
  const cGravel = new THREE.Color(pal.gravel ?? theme.terrain.dry);
  const cApron = new THREE.Color(pal.apron ?? pal.line);
  const cStripe = new THREE.Color(pal.runoffStripe ?? pal.runoffPaint);
  const scratch = new THREE.Color();

  // ═══ Run-off apron ═══════════════════════════════════
  const runoffMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: createGravelTexture(renderer),
  });
  disposables.push(runoffMat);

  for (const sign of [-1, 1]) {
    const geo = buildSurface(circuit, {
      columns: 5,
      step: Math.max(1, Math.round(2.4 / circuit.metresPerSample)),
      uvLength: 7,
      uvWidth: 7,
      lateral: (ctx, u) => sign * (halfW + kerbW + u * runoffW),
      // Stay level across the part cars can actually reach, then
      // feather the last stretch down to meet the flattened terrain.
      height: (ctx, u) => lerp(Y_RUNOFF, -0.38, smoothstep(0.82, 1, u)),
      color: (ctx, u) => {
        const corner = smoothstep(CORNER_CURVATURE * 0.45, CORNER_CURVATURE * 1.5, ctx.curvature);

        // Modern circuit: sealed asphalt run-off through the corners,
        // grass down the straights, gravel only at the tightest turns.
        scratch.copy(cRunoff).lerp(cRunoffAsphalt, corner);
        const tight = smoothstep(CORNER_CURVATURE * 1.7, CORNER_CURVATURE * 3, ctx.curvature);
        scratch.lerp(cGravel, tight * smoothstep(0.45, 0.85, u) * 0.9);

        // Diagonal blue-and-white paint on the asphalt run-off — the
        // thing that makes an aerial shot read as a Grand Prix circuit.
        if (corner > 0.3 && u > 0.12 && u < 0.62) {
          const diagonal = ctx.along * 0.42 + u * 26;
          const stripe = Math.floor(diagonal / 4) % 2 === 0;
          const band = smoothstep(0.12, 0.2, u) * (1 - smoothstep(0.5, 0.62, u));
          scratch.lerp(stripe ? cStripe : cApron, band * (corner - 0.3) / 0.7 * 0.75);
        }

        // Continuous white apron hugging the kerb, both sides, all the
        // way round. This is the edge definition the track was missing.
        scratch.lerp(cApron, (1 - smoothstep(0, 0.11, u)) * 0.92);
        return scratch;
      },
    });
    add(geo, runoffMat);
  }

  // ═══ Asphalt ═════════════════════════════════════════
  const roadMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: createAsphaltTexture(renderer),
  });
  disposables.push(roadMat);

  const meshStep = Math.max(1, Math.round(2.4 / circuit.metresPerSample));
  const roadGeo = buildSurface(circuit, {
    columns: 22,
    step: meshStep,
    uvLength: 11,
    uvWidth: 11,
    lateral: (ctx, u) => (u * 2 - 1) * halfW,
    // Crowned camber: a touch higher down the middle so the raking
    // light breaks across the surface instead of reading dead flat.
    height: (ctx, u) => Y_ROAD + 0.075 * (1 - (u * 2 - 1) ** 2),
    color: (ctx, u, lat) => {
      const edge = Math.abs(u * 2 - 1);
      // Worn wheel tracks either side of centre.
      const wear = Math.exp(-((Math.abs(lat) - halfW * 0.34) ** 2) / 6);
      scratch.copy(cAsphalt).lerp(cWorn, wear * 0.4);
      // Rubbered-in racing line: the darkest thing on the circuit.
      const line = racingLine[ctx.index];
      const rubber = Math.exp(-((lat - line) ** 2) / 14);
      scratch.lerp(cRubber, rubber * 0.5);
      // Resurfacing patches, so the tarmac is not one flat tone.
      const patch = Math.sin(ctx.along * 0.031) * Math.sin(ctx.along * 0.0113 + 2.1);
      scratch.lerp(cWorn, smoothstep(0.55, 0.95, patch) * 0.28);
      // A dark shoulder right at the edge. This is what makes the
      // boundary between asphalt and grass read as a hard line from
      // above rather than the two colours bleeding together.
      scratch.lerp(cShoulder, smoothstep(0.9, 1, edge) * 0.85);
      return scratch;
    },
  });
  add(roadGeo, roadMat);

  // ═══ Edge lines ══════════════════════════════════════
  const lineMat = new THREE.MeshLambertMaterial({ color: pal.line });
  disposables.push(lineMat);
  const lineGeos = [];
  for (const sign of [-1, 1]) {
    lineGeos.push(buildSurface(circuit, {
      columns: 1,
      step: Math.max(1, Math.round(1.6 / circuit.metresPerSample)),
      lateral: (ctx, u) => sign * (halfW - 0.82 + u * 0.6),
      height: () => Y_LINE,
    }));
  }
  add(mergeGeometries(lineGeos), lineMat);

  // ═══ Kerbs, only at genuine corners ══════════════════
  const kerbMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  disposables.push(kerbMat);

  const cornerRanges = findRanges(
    circuit,
    (i) => circuit.curvature[i] > CORNER_CURVATURE,
    { pad: 26, minLength: 18 },
  );

  const kerbGeos = [];
  for (const range of cornerRanges) {
    for (const sign of [-1, 1]) {
      kerbGeos.push(buildSurface(circuit, {
        start: range.start,
        count: range.count,
        columns: 3,
        lateral: (ctx, u) => sign * (halfW + u * kerbW),
        height: (ctx, u) => {
          // Taper the ends into the road so kerbs do not start with a step.
          const ends = smoothstep(0, 0.09, ctx.span) * (1 - smoothstep(0.91, 1, ctx.span));
          // Sawtooth along the kerb — the ridges you feel through the
          // wheel, and the thing that catches the low sun from above.
          const tooth = 0.035 * (Math.floor(ctx.along / (KERB_BLOCK / 2)) % 2);
          return (lerp(Y_KERB_IN, Y_KERB_OUT, u) + tooth * u) * ends + 0.008;
        },
        color: (ctx) => (Math.floor(ctx.along / KERB_BLOCK) % 2 === 0 ? cKerbA : cKerbB),
      }));
    }
  }
  add(mergeGeometries(kerbGeos), kerbMat, { shadow: 'both' });

  // ═══ Sector gates ════════════════════════════════════
  const sectorColors = [0xff4d2e, 0xffb020, 0x35e0a1];
  for (let s = 0; s < 3; s++) {
    const frame = circuit.frame(s / 3);
    const geo = new THREE.PlaneGeometry(trackWidth + kerbW * 2, 0.5);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: sectorColors[s], transparent: true, opacity: 0.42,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(frame.point).setY(frame.point.y + Y_PAINT);
    mesh.rotation.y = frame.heading;
    mesh.renderOrder = 2;
    group.add(mesh);
    disposables.push(geo, mat);
  }

  // ═══ Optional racing-line guide ══════════════════════
  const guideMat = new THREE.MeshBasicMaterial({
    color: 0x35e0a1, transparent: true, opacity: 0.32, depthWrite: false,
  });
  disposables.push(guideMat);
  const guideGeo = buildSurface(circuit, {
    columns: 1,
    step: Math.max(1, Math.round(1.6 / circuit.metresPerSample)),
    lateral: (ctx, u) => racingLine[ctx.index] + (u - 0.5) * 0.55,
    height: () => Y_PAINT + 0.01,
  });
  const guideLine = add(guideGeo, guideMat, { shadow: 'none', order: 3 });
  guideLine.visible = false;

  // ═══ Start / finish complex ══════════════════════════
  buildStartLine(group, circuit, theme, disposables);
  buildGridBoxes(group, circuit, theme, disposables);

  return {
    group,
    guideLine,
    racingLine,
    dispose() {
      scene.remove(group);
      for (const d of disposables) {
        if (d.map) d.map.dispose();
        d.dispose();
      }
    },
  };
}

// ── Start line ─────────────────────────────────────────

function buildStartLine(group, circuit, theme, disposables) {
  const frame = circuit.frame(0);
  const angle = frame.heading;
  const base = frame.point.clone();

  // Checker band.
  const cols = 12;
  const rows = 2;
  const cellW = circuit.width / cols;
  const cellL = 1.1;
  const light = new THREE.MeshLambertMaterial({ color: theme.road.line });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14161c });
  disposables.push(light, dark);

  const cellGeo = new THREE.PlaneGeometry(cellW, cellL);
  cellGeo.rotateX(-Math.PI / 2);
  disposables.push(cellGeo);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const mesh = new THREE.Mesh(cellGeo, (c + r) % 2 === 0 ? light : dark);
      const lateral = (c - cols / 2 + 0.5) * cellW;
      const along = (r - rows / 2 + 0.5) * cellL;
      mesh.position.copy(base)
        .addScaledVector(frame.side, lateral)
        .addScaledVector(frame.tangent, along);
      mesh.position.y = base.y + Y_PAINT;
      mesh.rotation.y = angle;
      mesh.renderOrder = 2;
      group.add(mesh);
    }
  }
}

// ── Painted grid boxes ─────────────────────────────────

function buildGridBoxes(group, circuit, theme, disposables) {
  const mat = new THREE.MeshBasicMaterial({
    color: theme.road.line, transparent: true, opacity: 0.75, depthWrite: false,
  });
  disposables.push(mat);

  const boxW = 3.0;
  const boxL = 5.4;
  const thickness = 0.22;
  const rowSpacing = 8.2;
  const lateral = Math.min(3.6, circuit.halfWidth * 0.45);

  // Four thin bars per box outline, built once and instanced by position.
  const longGeo = new THREE.PlaneGeometry(thickness, boxL);
  longGeo.rotateX(-Math.PI / 2);
  const shortGeo = new THREE.PlaneGeometry(boxW, thickness);
  shortGeo.rotateX(-Math.PI / 2);
  disposables.push(longGeo, shortGeo);

  for (let slot = 0; slot < GRID_SIZE; slot++) {
    const row = Math.floor(slot / 2);
    const col = slot % 2 === 0 ? -1 : 1;
    const distance = 9 + row * rowSpacing;
    const t = ((-distance / circuit.length) % 1 + 1) % 1;
    const frame = circuit.frame(t);

    const center = frame.point.clone().addScaledVector(frame.side, col * lateral);
    const parts = [
      { geo: longGeo, off: [-boxW / 2, 0] },
      { geo: longGeo, off: [boxW / 2, 0] },
      { geo: shortGeo, off: [0, -boxL / 2] },
    ];
    for (const part of parts) {
      const mesh = new THREE.Mesh(part.geo, mat);
      mesh.position.copy(center)
        .addScaledVector(frame.side, part.off[0])
        .addScaledVector(frame.tangent, part.off[1]);
      mesh.position.y = frame.point.y + Y_PAINT;
      mesh.rotation.y = frame.heading;
      mesh.renderOrder = 2;
      group.add(mesh);
    }
  }
}

// ── Textures ───────────────────────────────────────────
// Both are near-white so the theme's vertex colours own the hue;
// the maps contribute grain, cracks and patch repairs only.

function createAsphaltTexture(renderer) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(4242);

  ctx.fillStyle = '#f2f2f4';
  ctx.fillRect(0, 0, size, size);

  // Aggregate: two grain scales so the surface still reads as a
  // material from 40 m up rather than dissolving into flat grey.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 26 + (rng() - 0.5) * 14;
    d[i] = clampByte(d[i] + n);
    d[i + 1] = clampByte(d[i + 1] + n);
    d[i + 2] = clampByte(d[i + 2] + n * 1.12);
  }
  ctx.putImageData(img, 0, 0);

  // Coarse stone, big enough to survive the camera distance.
  for (let i = 0; i < 5200; i++) {
    const shade = 176 + Math.floor(rng() * 90);
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 6},${0.25 + rng() * 0.45})`;
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, 1.4 + rng() * 4.2, 1 + rng() * 3, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Resurfacing patches with visible edges.
  for (let i = 0; i < 22; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const w = 60 + rng() * 220;
    const h = 40 + rng() * 150;
    const shade = 206 + Math.floor(rng() * 36);
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 5},0.5)`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = `rgba(140,140,150,${0.25 + rng() * 0.3})`;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(x, y, w, h);
  }

  // Transverse joint seams — the giveaway that this is laid asphalt.
  for (let i = 0; i < 9; i++) {
    const y = rng() * size;
    ctx.strokeStyle = `rgba(138,138,148,${0.35 + rng() * 0.3})`;
    ctx.lineWidth = 1.6 + rng() * 1.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 24) ctx.lineTo(x, y + (rng() - 0.5) * 4);
    ctx.stroke();
  }

  // Cracks.
  for (let i = 0; i < 16; i++) {
    let x = rng() * size;
    let y = rng() * size;
    const angle = rng() * Math.PI;
    ctx.strokeStyle = `rgba(112,112,122,${0.3 + rng() * 0.35})`;
    ctx.lineWidth = 1 + rng() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 26; s++) {
      x += Math.cos(angle) * 9 + (rng() - 0.5) * 7;
      y += Math.sin(angle) * 9 + (rng() - 0.5) * 7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Chips catching the low sun.
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.12 + rng() * 0.3})`;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 0.7 + rng() * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  return finishTexture(canvas, renderer, 1, 1);
}

function createGravelTexture(renderer) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = makeRng(8080);

  ctx.fillStyle = '#efece5';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const shade = 190 + Math.floor(rng() * 60);
    ctx.fillStyle = `rgba(${shade},${shade - 4},${shade - 14},${0.3 + rng() * 0.5})`;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 0.7 + rng() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  return finishTexture(canvas, renderer, 1, 1);
}

function finishTexture(canvas, renderer, repeatX, repeatY) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

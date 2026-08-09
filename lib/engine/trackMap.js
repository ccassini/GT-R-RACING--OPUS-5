// ═══════════════════════════════════════════════════════
//  TRACK MAP — canvas circuit drawing
//
//  Shared by the setup screen's big map card and the in-race
//  minimap, so the shape the player picks is the shape they read
//  at 200 km/h.
// ═══════════════════════════════════════════════════════

/**
 * Fit a circuit outline into a canvas and return the projection.
 * @returns {(x: number, z: number) => [number, number]}
 */
function makeProjection(points, width, height, margin) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanZ);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanZ * scale) / 2;

  // Flip Z so north is up, matching the world as seen from the bird camera.
  return (x, z) => [
    offsetX + (x - minX) * scale,
    offsetY + (maxZ - z) * scale,
  ];
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../world/track.js').Circuit} circuit
 * @param {object} opts
 */
export function drawCircuitMap(ctx, circuit, opts = {}) {
  const {
    margin = 18,
    ribbon = 'rgba(242,237,227,0.14)',
    line = '#f2ede3',
    lineWidth = 2.4,
    ribbonWidth = 9,
    showStart = true,
    showSectors = false,
    markers = [],
    ghost = null,
    plate = null,
  } = opts;

  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  // Over a bright aerial view the bare outline disappears, so the
  // in-race map sits on its own plate.
  if (plate) {
    ctx.fillStyle = plate;
    ctx.beginPath();
    ctx.roundRect(1, 1, width - 2, height - 2, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,237,227,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const points = circuit.outline(200);
  const project = makeProjection(points, width, height, margin);

  const trace = () => {
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const [px, py] = project(points[i].x, points[i].z);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  // Track ribbon underneath, centre line on top.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ribbon;
  ctx.lineWidth = ribbonWidth;
  trace();
  ctx.stroke();

  ctx.strokeStyle = line;
  ctx.lineWidth = lineWidth;
  trace();
  ctx.stroke();

  if (ghost) {
    ctx.save();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = ghost;
    ctx.lineWidth = 1;
    trace();
    ctx.stroke();
    ctx.restore();
  }

  if (showSectors) {
    const colors = ['#ff4d2e', '#ffb020', '#35e0a1'];
    for (let s = 0; s < 3; s++) {
      const idx = circuit.indexAt(s / 3);
      const [px, py] = project(circuit.px[idx], circuit.pz[idx]);
      ctx.fillStyle = colors[s];
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (showStart) {
    const idx = circuit.indexAt(0);
    const [px, py] = project(circuit.px[idx], circuit.pz[idx]);
    const angle = Math.atan2(circuit.sx[idx], -circuit.sz[idx]);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.fillStyle = '#f2ede3';
    ctx.fillRect(-7, -1.6, 14, 3.2);
    ctx.fillStyle = '#0b0e13';
    for (let i = 0; i < 4; i++) ctx.fillRect(-7 + i * 3.5, -1.6, 1.75, 3.2);
    ctx.restore();
  }

  for (const marker of markers) {
    const [px, py] = project(marker.x, marker.z);
    if (marker.heading !== undefined) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(marker.heading);
      ctx.fillStyle = marker.color;
      ctx.beginPath();
      ctx.moveTo(0, -marker.size);
      ctx.lineTo(-marker.size * 0.72, marker.size * 0.68);
      ctx.lineTo(marker.size * 0.72, marker.size * 0.68);
      ctx.closePath();
      ctx.fill();
      if (marker.outline) {
        ctx.strokeStyle = marker.outline;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.fillStyle = marker.color;
      ctx.beginPath();
      ctx.arc(px, py, marker.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

import {
  MAX_DEPTH,
  boundsAround,
  clamp,
  insideWorld,
  spanAt,
  validPosition,
} from "./world.mjs";

// Geometry uses one iteration budget at every scale. Rendering and collisions
// share this value, so changing size does not change which set defines rock.
export const TERRAIN_ITERATIONS = 512;
export const BODY_FRACTION = 0.018;
export const bodyRadiusAt = (depth) => spanAt(depth) * BODY_FRACTION;
export const PASSAGE = Object.freeze({ x: -0.7515, y: 0.04, depth: 7 });

// Points in the main cardioid or the period-2 bulb never escape.
function inMainBulbs(x, y) {
  const q = (x - 0.25) ** 2 + y * y;
  return q * (q + x - 0.25) <= 0.25 * y * y || (x + 1) ** 2 + y * y <= 0.0625;
}

export function escapeIterations(x, y, max = TERRAIN_ITERATIONS) {
  if (inMainBulbs(x, y)) return max;
  let zx = 0,
    zy = 0;
  for (let i = 0; i < max; i++) {
    const next = zx * zx - zy * zy + x;
    zy = 2 * zx * zy + y;
    zx = next;
    if (zx * zx + zy * zy > 256)
      return i + 1 - Math.log2(Math.log2(Math.sqrt(zx * zx + zy * zy)));
  }
  return max;
}

// The exterior distance estimate is used to generate conservative static cells,
// not as an exact signed distance function or a contact normal.
export function fractalClearance(x, y) {
  if (inMainBulbs(x, y)) return 0;
  let zx = 0,
    zy = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < TERRAIN_ITERATIONS; i++) {
    const nextDx = 2 * (zx * dx - zy * dy) + 1;
    const nextDy = 2 * (zx * dy + zy * dx);
    const nextX = zx * zx - zy * zy + x;
    zy = 2 * zx * zy + y;
    zx = nextX;
    dx = nextDx;
    dy = nextDy;
    const squared = zx * zx + zy * zy;
    if (squared > 256) {
      const estimate =
        0.5 * Math.log(squared) * Math.sqrt(squared / (dx * dx + dy * dy));
      return Number.isFinite(estimate) ? Math.max(0, estimate * 0.25) : 0;
    }
  }
  return 0;
}

function overlapsCircle(body, radius, cell) {
  const x = clamp(body.x, cell.minX, cell.maxX);
  const y = clamp(body.y, cell.minY, cell.maxY);
  return (x - body.x) ** 2 + (y - body.y) ** 2 < radius * radius;
}

export class FractalCollider {
  constructor({ clearance = fractalClearance, maxCells = 80000 } = {}) {
    this.clearance = clearance;
    this.maxCells = maxCells;
    this.cells = new Map();
  }
  cell(level, ix, iy) {
    const key = `${level}:${ix}:${iy}`;
    const cached = this.cells.get(key);
    if (cached) return cached;
    const size = spanAt(level);
    const minX = ix * size,
      minY = iy * size;
    // Empty parents stay empty at every finer level. This makes the generated
    // solid geometry nested, so a body that fits always has room to shrink.
    const parentSolid =
      level === 0 ||
      this.cell(level - 1, Math.floor(ix / 2), Math.floor(iy / 2)).solid;
    const solid =
      parentSolid &&
      this.clearance(minX + size / 2, minY + size / 2) <= size * Math.SQRT1_2;
    const cell = { minX, minY, maxX: minX + size, maxY: minY + size, solid };
    this.cells.set(key, cell);
    if (this.cells.size > this.maxCells) {
      const oldest = this.cells.keys();
      for (let i = 0; i < this.maxCells / 4; i++)
        this.cells.delete(oldest.next().value);
    }
    return cell;
  }
  fits(body) {
    if (!validPosition(body)) return false;
    const radius = bodyRadiusAt(body.depth);
    const bounds = boundsAround(body, radius);
    return (
      insideWorld(bounds) &&
      !this.intersectsSolid(bounds, body.depth, (cell) =>
        overlapsCircle(body, radius, cell),
      )
    );
  }
  rectangleFits(bounds, depth) {
    return (
      insideWorld(bounds) &&
      !this.intersectsSolid(
        bounds,
        depth,
        (cell) =>
          bounds.minX < cell.maxX &&
          bounds.maxX > cell.minX &&
          bounds.minY < cell.maxY &&
          bounds.maxY > cell.minY,
      )
    );
  }
  // Whether a solid cell at the collision level for this depth intersects.
  // Only solid parents that intersect are refined.
  intersectsSolid(bounds, depth, intersects) {
    const level = Math.ceil(depth) + 9;
    const visit = (at, ix, iy) => {
      const cell = this.cell(at, ix, iy);
      if (!cell.solid || !intersects(cell)) return false;
      if (at === level) return true;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++)
          if (visit(at + 1, ix * 2 + dx, iy * 2 + dy)) return true;
      return false;
    };
    const rootSize = spanAt(0);
    for (
      let iy = Math.floor(bounds.minY / rootSize);
      iy <= Math.floor(bounds.maxY / rootSize);
      iy++
    )
      for (
        let ix = Math.floor(bounds.minX / rootSize);
        ix <= Math.floor(bounds.maxX / rootSize);
        ix++
      )
        if (visit(0, ix, iy)) return true;
    return false;
  }
}

export function resizeBody(body, requestedDepth, collider) {
  const depth = clamp(requestedDepth, 0, MAX_DEPTH);
  if (!Number.isFinite(depth)) return { ...body, blocked: true };
  if (depth >= body.depth) return { ...body, depth, blocked: false };
  if (collider.fits({ ...body, depth }))
    return { ...body, depth, blocked: false };
  let blocked = depth,
    clear = body.depth;
  for (let i = 0; i < 14; i++) {
    const middle = (blocked + clear) / 2;
    if (collider.fits({ ...body, depth: middle })) clear = middle;
    else blocked = middle;
  }
  return { ...body, depth: clear, blocked: true };
}

export function moveBody(body, delta, collider) {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y))
    return { ...body, blocked: true };
  const radius = bodyRadiusAt(body.depth);
  const length = Math.hypot(delta.x, delta.y);
  if (!length) return { ...body, blocked: false };
  // Cap the covered distance rather than widening substeps when a client stalls.
  // A large jump cannot skip the collision geometry between its endpoints.
  const travel = Math.min(length, radius * 0.4 * 160);
  const steps = Math.max(1, Math.ceil(travel / (radius * 0.4)));
  const dx = ((delta.x / length) * travel) / steps,
    dy = ((delta.y / length) * travel) / steps;
  const moved = { ...body, blocked: travel < length };
  function axis(amount, key) {
    if (!amount) return;
    const candidate = { ...moved, [key]: moved[key] + amount };
    if (collider.fits(candidate)) {
      moved[key] = candidate[key];
      return;
    }
    moved.blocked = true;
    let clear = 0,
      blocked = 1;
    for (let i = 0; i < 10; i++) {
      const middle = (clear + blocked) / 2;
      if (collider.fits({ ...moved, [key]: moved[key] + amount * middle }))
        clear = middle;
      else blocked = middle;
    }
    moved[key] += amount * clear;
  }
  for (let i = 0; i < steps; i++) {
    const candidate = { ...moved, x: moved.x + dx, y: moved.y + dy };
    if (collider.fits(candidate)) {
      moved.x = candidate.x;
      moved.y = candidate.y;
    } else {
      moved.blocked = true;
      axis(dx, "x");
      axis(dy, "y");
    }
  }
  return moved;
}

// Following uses ordinary collisions: take the smaller of the two bodies, walk
// towards the target, then return to its size where the body fits.
export function approachBody(body, target, collider) {
  const smaller = resizeBody(
    body,
    Math.max(body.depth, target.depth),
    collider,
  );
  const moved = moveBody(
    smaller,
    { x: target.x - body.x, y: target.y - body.y },
    collider,
  );
  return resizeBody(moved, target.depth, collider);
}

export function findClearSpawn(position, collider) {
  const body = { x: position.x, y: position.y, depth: position.depth };
  if (collider.fits(body)) return body;
  const radius = bodyRadiusAt(body.depth);
  for (let ring = 1; ring <= 48; ring++) {
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const candidate = {
        ...body,
        x: body.x + Math.cos(angle) * radius * ring * 0.7,
        y: body.y + Math.sin(angle) * radius * ring * 0.7,
      };
      if (collider.fits(candidate)) return candidate;
    }
  }
  return null;
}

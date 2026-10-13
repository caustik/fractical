import { MAX_DEPTH, spanAt, clamp } from "./world.mjs";
import { FractalCollider, bodyRadiusAt } from "./physics.mjs";

export const MATERIALS = Object.freeze({
  stone: Object.freeze({ name: "Stone", fill: "#a8a78b", edge: "#e5dfb6" }),
  glass: Object.freeze({ name: "Glass", fill: "#5dada899", edge: "#bce7d6" }),
  glow: Object.freeze({ name: "Glow", fill: "#d3a157", edge: "#ffe1a0" }),
});
export const MAX_BLOCKS = 1024;
export const BUILD_REACH = 6;
export const BLOCK_COOLDOWN_MS = 120;
export const blockSizeAt = (depth) => spanAt(depth) * 0.04;
export const cellKey = (cell) => `${cell.depth}:${cell.ix}:${cell.iy}`;

export function blockBounds(block) {
  const size = blockSizeAt(block.depth);
  return {
    minX: block.ix * size,
    maxX: (block.ix + 1) * size,
    minY: block.iy * size,
    maxY: (block.iy + 1) * size,
  };
}
export function blockPosition(cell) {
  const size = blockSizeAt(cell.depth);
  return {
    x: (cell.ix + 0.5) * size,
    y: (cell.iy + 0.5) * size,
    depth: cell.depth,
  };
}
export function cellAt(point, depth) {
  const level = clamp(Math.round(depth), 0, MAX_DEPTH),
    size = blockSizeAt(level);
  return {
    ix: Math.floor(point.x / size),
    iy: Math.floor(point.y / size),
    depth: level,
  };
}
export function validCell(cell) {
  if (
    !cell ||
    !Number.isSafeInteger(cell.ix) ||
    !Number.isSafeInteger(cell.iy) ||
    !Number.isInteger(cell.depth) ||
    cell.depth < 0 ||
    cell.depth > MAX_DEPTH
  )
    return false;
  const b = blockBounds(cell);
  return b.minX >= -3 && b.maxX <= 3 && b.minY >= -2 && b.maxY <= 2;
}
export function rectanglesOverlap(a, b) {
  const epsilon = Math.min(a.maxX - a.minX, b.maxX - b.minX) * 1e-8;
  return (
    a.minX < b.maxX - epsilon &&
    a.maxX > b.minX + epsilon &&
    a.minY < b.maxY - epsilon &&
    a.maxY > b.minY + epsilon
  );
}
export function bodyOverlapsBlock(body, block) {
  const b = blockBounds(block),
    radius = bodyRadiusAt(body.depth);
  return (
    (body.x - clamp(body.x, b.minX, b.maxX)) ** 2 +
      (body.y - clamp(body.y, b.minY, b.maxY)) ** 2 <
    radius * radius
  );
}
export function withinBuildReach(cell, player) {
  const p = blockPosition(cell);
  return (
    cell.depth === Math.round(player.depth) &&
    Math.hypot(p.x - player.x, p.y - player.y) <=
      blockSizeAt(cell.depth) * BUILD_REACH
  );
}
export function placementProblem(cell, player, players, blocks, terrain) {
  if (!validCell(cell)) return "Choose a cell inside the world.";
  if (!withinBuildReach(cell, player))
    return "Walk closer. Build at your current scale.";
  const bounds = blockBounds(cell);
  if (!terrain.rectangleFits(bounds, cell.depth))
    return "That cell intersects fractal rock.";
  if (blocks.some((block) => rectanglesOverlap(bounds, blockBounds(block))))
    return "That cell is already occupied.";
  if (players.some((body) => bodyOverlapsBlock(body, cell)))
    return "Leave room for the explorers.";
  return null;
}
export function pickBlock(point, blocks) {
  return blocks.find((block) => {
    const b = blockBounds(block);
    return (
      point.x >= b.minX &&
      point.x <= b.maxX &&
      point.y >= b.minY &&
      point.y <= b.maxY
    );
  });
}

// Index each construction scale so tiny blocks do not require huge grid scans
// when a large explorer checks its footprint.
export class WorldCollider {
  constructor(terrain = new FractalCollider(), blocks = []) {
    this.terrain = terrain;
    this.setBlocks(blocks);
  }
  setBlocks(blocks) {
    this.levels = new Map();
    for (const block of blocks) {
      if (!this.levels.has(block.depth))
        this.levels.set(block.depth, new Map());
      this.levels.get(block.depth).set(`${block.ix}:${block.iy}`, block);
    }
  }
  contacts(body, limit = 1) {
    const contacts = this.terrain.contacts(body, limit);
    if (contacts.length >= limit) return contacts;
    const radius = bodyRadiusAt(body.depth);
    for (const [depth, cells] of this.levels) {
      const size = blockSizeAt(depth);
      const minX = Math.floor((body.x - radius) / size),
        maxX = Math.floor((body.x + radius) / size);
      const minY = Math.floor((body.y - radius) / size),
        maxY = Math.floor((body.y + radius) / size);
      const visit = (block) => {
        if (block && bodyOverlapsBlock(body, block))
          contacts.push({ type: "block", block });
      };
      if ((maxX - minX + 1) * (maxY - minY + 1) > cells.size) {
        for (const block of cells.values()) {
          visit(block);
          if (contacts.length >= limit) return contacts;
        }
      } else {
        for (let iy = minY; iy <= maxY; iy++)
          for (let ix = minX; ix <= maxX; ix++) {
            visit(cells.get(`${ix}:${iy}`));
            if (contacts.length >= limit) return contacts;
          }
      }
    }
    return contacts;
  }
  fits(body) {
    return this.contacts(body).length === 0;
  }
}

export function blockClusters(blocks) {
  const remaining = new Map(blocks.map((block) => [cellKey(block), block]));
  const groups = [];
  while (remaining.size) {
    const first = remaining.values().next().value,
      queue = [first],
      group = [];
    remaining.delete(cellKey(first));
    for (let i = 0; i < queue.length; i++) {
      const block = queue[i];
      group.push(block);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const key = cellKey({ ...block, ix: block.ix + dx, iy: block.iy + dy });
        if (remaining.has(key)) {
          queue.push(remaining.get(key));
          remaining.delete(key);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

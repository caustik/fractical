import test from "node:test";
import assert from "node:assert/strict";
import { motionBetween } from "../public/world.mjs";
import {
  FractalCollider,
  moveBody,
  resizeBody,
  bodyRadiusAt,
} from "../public/physics.mjs";
import {
  WorldCollider,
  blockPosition,
  blockBounds,
  cellAt,
  placementProblem,
  movementProblem,
  blockSizeAt,
  blockClusters,
} from "../public/building.mjs";

const clear = () => new FractalCollider({ clearance: () => 100 });

test("the canvas caret agrees with world displacement in every cardinal and diagonal direction", () => {
  const from = { x: 0, y: 0, depth: 4, heading: 0.7 };
  for (const [dx, dy] of [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
    [-1, -1],
  ]) {
    const { heading, moving } = motionBetween(from, { ...from, x: dx, y: dy });
    const length = Math.hypot(dx, dy);
    assert.equal(moving, true);
    assert.ok(Math.abs(Math.sin(heading) - dx / length) < 1e-12);
    assert.ok(Math.abs(-Math.cos(heading) - -dy / length) < 1e-12);
  }
  assert.deepEqual(motionBetween(from, from), { heading: 0.7, moving: false });
});

test("moving a square keeps its size and moves the solid footprint", () => {
  const block = { id: "moving", ix: 0, iy: 0, depth: 4 },
    target = { ix: 3, iy: 0, depth: 4 },
    size = blockSizeAt(4),
    player = { x: 0, y: -size * 2, depth: 4 },
    terrain = clear();
  assert.equal(
    movementProblem(block, target, player, [player], [block], terrain),
    null,
  );
  const moved = { ...block, ...target },
    collider = new WorldCollider(terrain, [moved]);
  assert.equal(collider.fits(blockPosition(block)), true);
  assert.equal(collider.fits(blockPosition(moved)), false);
  const before = blockBounds(block),
    after = blockBounds(moved);
  assert.ok(
    Math.abs(before.maxX - before.minX - (after.maxX - after.minX)) < 1e-12,
  );
  assert.match(
    movementProblem(
      block,
      { ...target, depth: 5 },
      player,
      [],
      [block],
      terrain,
    ),
    /original size/,
  );
  assert.match(
    movementProblem(block, { ...target, ix: 50 }, player, [], [block], terrain),
    /closer/,
  );
  assert.match(
    movementProblem(
      block,
      { ...target, ix: NaN },
      player,
      [],
      [block],
      terrain,
    ),
    /inside the world/,
  );
});

test("square sweeps catch thin rock, tiny blocks, and tiny explorers between clear endpoints", () => {
  const block = { id: "moving", ix: 0, iy: 0, depth: 4 },
    target = { ix: 3, iy: 0, depth: 4 },
    size = blockSizeAt(4),
    player = { x: 0, y: -size * 2, depth: 4 },
    tiny = { id: "tiny", ix: 384, iy: 128, depth: 12 },
    body = { x: size * 1.5, y: size * 0.5, depth: 18 },
    wall = new FractalCollider({
      clearance: (x) => Math.max(0, Math.abs(x - size * 1.5) - 1e-7),
    });
  assert.equal(
    placementProblem(target, player, [player, body], [tiny], wall),
    null,
  );
  assert.match(
    movementProblem(block, target, player, [player], [block], wall),
    /path crosses fractal rock/,
  );
  assert.match(
    movementProblem(block, target, player, [player], [block, tiny], clear()),
    /block.*path/,
  );
  assert.match(
    movementProblem(block, target, player, [player, body], [block], clear()),
    /path.*explorers/,
  );
});

test("diagonal square sweeps allow clear corners and touching adjacent blocks", () => {
  const block = { id: "moving", ix: 0, iy: 0, depth: 4 },
    size = blockSizeAt(4),
    player = { x: 0, y: size * 3, depth: 4 },
    corner = { x: -size * 0.2, y: size * 1.2, depth: 5 },
    obstacle = { id: "corner", ix: 0, iy: 3, depth: 4 };
  assert.equal(
    movementProblem(
      block,
      { ix: 3, iy: 3, depth: 4 },
      player,
      [player, corner],
      [block, obstacle],
      clear(),
    ),
    null,
  );
  const adjacent = { id: "adjacent", ix: 1, iy: -1, depth: 4 };
  assert.equal(
    movementProblem(
      block,
      { ix: 3, iy: 0, depth: 4 },
      player,
      [player],
      [block, adjacent],
      clear(),
    ),
    null,
  );
});

test("individual blocks form arbitrary connected shapes without predefined structures", () => {
  const blocks = [
    [0, 0],
    [1, 0],
    [1, 1],
    [1, 2],
    [4, 4],
  ].map(([ix, iy]) => ({ ix, iy, depth: 4 }));
  const groups = blockClusters(blocks);
  assert.deepEqual(
    groups.map((g) => g.length),
    [4, 1],
  );
  const player = { x: 0.0035, y: -0.01, depth: 4 };
  const adjacent = { ix: 2, iy: 0, depth: 4 };
  assert.equal(
    placementProblem(adjacent, player, [player], blocks.slice(0, 4), clear()),
    null,
  );
  assert.ok(
    placementProblem(
      { ix: 2, iy: 0, depth: 5 },
      { ...player, depth: 5 },
      [],
      blocks,
      clear(),
    ),
  );
});

test("placed blocks stop movement, constrain growth, slide the caret along the actual path, and disappear on removal", () => {
  const block = { ix: 0, iy: 0, depth: 4 };
  const terrain = clear(),
    collider = new WorldCollider(terrain, [block]);
  const body = { x: -0.01, y: 0.0035, depth: 4, heading: 1 };
  const stopped = moveBody(body, { x: 0.04, y: 0 }, collider);
  assert.ok(stopped.x <= -bodyRadiusAt(body.depth));
  assert.equal(collider.fits(stopped), true);
  const slid = moveBody(stopped, { x: 0.004, y: 0.002 }, collider);
  const motion = motionBetween(stopped, slid);
  assert.ok(
    Math.abs(motion.heading) < 0.01,
    "a northward wall slide points north rather than towards the wall",
  );
  const grown = resizeBody(stopped, 0, collider);
  assert.equal(grown.blocked, true);
  assert.equal(grown.x, stopped.x);
  assert.equal(collider.fits(grown), true);
  collider.setBlocks([]);
  assert.equal(collider.fits(blockPosition(block)), true);
  assert.ok(moveBody(body, { x: 0.04, y: 0 }, collider).x > 0);
});

test("a block footprint cannot bury fractal geometry or an explorer, even at a different scale", () => {
  const cell = { ix: 0, iy: 0, depth: 4 },
    player = { x: -0.01, y: 0.0035, depth: 4 };
  const wall = new FractalCollider({
    clearance: (x) => Math.max(0, Math.abs(x - 0.0035) - 0.00001),
  });
  assert.ok(
    placementProblem(cell, player, [player], [], wall).includes("fractal rock"),
  );
  assert.ok(
    placementProblem(
      cell,
      player,
      [player, { ...blockPosition(cell), depth: 8 }],
      [],
      clear(),
    ).includes("explorers"),
  );
  const bounds = blockBounds(cell);
  assert.ok(Math.abs(bounds.maxX - bounds.minX - 0.007) < 1e-12);
  assert.equal(placementProblem(cell, player, [player], [], clear()), null);
  const tiny = { ix: 1, iy: 1, depth: 5 };
  assert.ok(
    placementProblem(
      tiny,
      { ...player, ...blockPosition(tiny) },
      [],
      [cell],
      clear(),
    ).includes("occupied"),
  );
  assert.deepEqual(cellAt(blockPosition(cell), 4), cell);
});

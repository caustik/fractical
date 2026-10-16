import test from "node:test";
import assert from "node:assert/strict";
import { HOME } from "../public/world.mjs";
import {
  FractalCollider,
  PASSAGE,
  bodyRadiusAt,
  moveBody,
  resizeBody,
} from "../public/physics.mjs";

test("a real Mandelbrot passage is blocked at the starting size and reachable after shrinking", () => {
  const collider = new FractalCollider();
  assert.equal(collider.fits(HOME), true);
  assert.equal(collider.fits({ ...PASSAGE, depth: HOME.depth }), false);
  assert.equal(collider.fits(PASSAGE), true);
  const stopped = moveBody(
    HOME,
    { x: PASSAGE.x - HOME.x, y: PASSAGE.y - HOME.y },
    collider,
  );
  assert.equal(stopped.blocked, true);
  assert.ok(stopped.y > PASSAGE.y + 0.01);
  let smaller = resizeBody(stopped, PASSAGE.depth, collider);
  for (let i = 0; i < 4; i++)
    smaller = moveBody(
      smaller,
      { x: PASSAGE.x - smaller.x, y: PASSAGE.y - smaller.y },
      collider,
    );
  assert.equal(smaller.x, PASSAGE.x);
  assert.equal(smaller.y, PASSAGE.y);
  assert.equal(collider.fits(smaller), true);
});

test("growth stops at the last legal size without moving the body out of a gap", () => {
  const collider = new FractalCollider();
  const grown = resizeBody(PASSAGE, HOME.depth, collider);
  assert.equal(grown.blocked, true);
  assert.ok(grown.depth > HOME.depth && grown.depth < PASSAGE.depth);
  assert.equal(grown.x, PASSAGE.x);
  assert.equal(grown.y, PASSAGE.y);
  assert.equal(collider.fits(grown), true);
  assert.equal(collider.fits({ ...grown, depth: grown.depth - 0.01 }), false);
  const shrunk = resizeBody(grown, 18, collider);
  assert.equal(shrunk.blocked, false);
  assert.equal(collider.fits(shrunk), true);
});

test("fast movement cannot cross a thin wall, and diagonal input slides along it", () => {
  const collider = new FractalCollider({
    clearance: (x) => Math.max(0, Math.abs(x) - 0.00001),
  });
  const body = { x: -0.06, y: 0.4, depth: 4 };
  const moved = moveBody(body, { x: 0.12, y: 0 }, collider);
  assert.equal(moved.blocked, true);
  assert.ok(moved.x < -bodyRadiusAt(body.depth));
  assert.equal(collider.fits(moved), true);
  const slid = moveBody(moved, { x: 0.02, y: 0.02 }, collider);
  assert.ok(slid.x < 0);
  assert.ok(slid.y > moved.y + 0.019);
  assert.equal(collider.fits(slid), true);
});

test("refinement preserves room to shrink and body bounds include the full radius", () => {
  const collider = new FractalCollider();
  const spots = [HOME, PASSAGE, { x: -2.5, y: 0.5, depth: 0 }];
  for (const body of spots) {
    assert.equal(collider.fits(body), true);
    for (let depth = body.depth; depth <= 18; depth += 0.3)
      assert.equal(collider.fits({ ...body, depth }), true);
  }
  assert.equal(collider.fits({ x: 3, y: 0, depth: 4 }), false);
  assert.equal(collider.fits({ x: 0, y: 0, depth: 18 }), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { createFracticalServer } from "../server.mjs";
import {
  HOME,
  MAX_DEPTH,
  escapeIterations,
  readPosition,
  validPosition,
  WORLD_VERSION,
} from "../public/world.mjs";
import { FractalCollider, PASSAGE } from "../public/physics.mjs";
import { cellAt, WorldCollider, blockPosition } from "../public/building.mjs";

const BUILD_HOME = { x: -2.5, y: 0.5, depth: 4 };
const place = (material = "stone", dx = 2, dy = 0) => {
  const cell = cellAt(BUILD_HOME, BUILD_HOME.depth);
  return {
    type: "place-block",
    ...cell,
    ix: cell.ix + dx,
    iy: cell.iy + dy,
    material,
  };
};
const builder = (app, name, room = "test-expedition") =>
  explorer(app, name, room, BUILD_HOME);

const qaRoot = path.resolve(".qa");
await (await import("node:fs/promises")).mkdir(qaRoot, { recursive: true });
async function removeOwnedQaDirectory(directory) {
  const target = path.resolve(directory);
  assert.ok(
    target.startsWith(qaRoot + path.sep),
    "QA cleanup must stay within the owned QA directory",
  );
  await rm(target, { recursive: true, force: true });
}
async function setup(t) {
  const dir = await mkdtemp(path.join(qaRoot, "server-"));
  const app = await createFracticalServer({ port: 0, dataDir: dir });
  t.after(async () => {
    await app.close();
    await removeOwnedQaDirectory(dir);
  });
  return { app, dir };
}
async function explorer(app, name, room = "test-expedition", extras = {}) {
  const socket = new WebSocket(app.url.replace("http:", "ws:") + "/live");
  const messages = [];
  const waiters = new Set();
  socket.on("message", (data) => {
    const value = JSON.parse(data);
    messages.push(value);
    for (const waiter of waiters)
      if (waiter.predicate(value)) {
        clearTimeout(waiter.timer);
        waiters.delete(waiter);
        waiter.resolve(value);
      }
  });
  const wait = (predicate, timeout = 3000) => {
    const found = messages.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("Message timed out"));
        }, timeout),
      };
      waiters.add(waiter);
    });
  };
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const send = (value) => socket.send(JSON.stringify(value));
  send({ type: "join", name, room, ...HOME, ...extras });
  const welcome = await wait((value) => value.type === "welcome");
  return {
    socket,
    send,
    wait,
    welcome,
    messages,
    clear: () => {
      messages.length = 0;
    },
  };
}

test("world coordinates remain finite, bounded, and recover from malformed links", () => {
  assert.equal(validPosition(HOME), true);
  for (const value of [
    { ...HOME, depth: MAX_DEPTH + 1 },
    { ...HOME, x: NaN },
    { ...HOME, y: Infinity },
    { ...HOME, x: 4 },
    { ...HOME, depth: -1 },
    null,
  ])
    assert.equal(Boolean(validPosition(value)), false);
  assert.deepEqual(readPosition(new URLSearchParams("x=broken&y=0&d=5")), HOME);
  assert.deepEqual(
    readPosition(new URLSearchParams("x=-0.7435&y=0.1314&d=12")),
    { x: -0.7435, y: 0.1314, depth: 12 },
  );
  assert.equal(escapeIterations(0, 0, 300), 300);
  assert.ok(escapeIterations(2, 1, 300) < 10);
});

test("real connections share actual movement, preset signals, color updates, and departure", async (t) => {
  const { app } = await setup(t);
  const a = await explorer(app, "Ada"),
    b = await explorer(app, "Lin");
  assert.equal(b.welcome.players.length, 2);
  assert.ok(b.welcome.players.some((player) => player.id === a.welcome.id));
  a.send({
    type: "move",
    x: HOME.x,
    y: HOME.y + 0.001,
    depth: HOME.depth,
    heading: 1,
    moving: true,
  });
  const snapshot = await b.wait(
    (message) =>
      message.type === "players" &&
      message.players.some(
        (player) => player.id === a.welcome.id && player.y === HOME.y + 0.001,
      ),
  );
  const ada = snapshot.players.find((player) => player.id === a.welcome.id);
  assert.equal(ada.x, HOME.x);
  assert.equal(ada.depth, HOME.depth);
  assert.equal(ada.moving, true);
  assert.equal(
    ada.heading,
    0,
    "server derives north from actual displacement, ignoring the supplied heading",
  );
  a.send({
    type: "signal",
    signal: "here",
    text: "<img src=x onerror=alert(1)> Meet at the little island.",
  });
  const signal = await b.wait((message) => message.type === "signal");
  assert.equal(signal.message.playerId, a.welcome.id);
  assert.equal(signal.message.signal, "here");
  assert.equal("text" in signal.message, false);
  a.send({ type: "profile", name: "Ada the explorer", color: "#9bd5c5" });
  await b.wait(
    (message) =>
      message.type === "players" &&
      message.players.some(
        (player) => player.id === a.welcome.id && player.color === "#9bd5c5",
      ),
  );
  a.socket.close();
  await b.wait(
    (message) => message.type === "departure" && message.id === a.welcome.id,
  );
});

test("rooms isolate signals and blocks and never expose ownership credentials", async (t) => {
  const { app } = await setup(t);
  const a = await builder(app, "Ada", "room-one"),
    b = await builder(app, "Lin", "room-two");
  a.send({ type: "signal", signal: "hello" });
  a.send({
    ...place(),
    requestId: "build-one",
  });
  const saved = await a.wait(
    (message) => message.type === "blocks" && message.requestId === "build-one",
  );
  assert.equal(saved.blocks.length, 1);
  assert.equal(saved.blocks[0].owned, true);
  assert.equal("owner" in saved.blocks[0], false);
  assert.equal(b.welcome.blocks.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(
    b.messages.some(
      (message) => message.type === "signal" || message.type === "blocks",
    ),
    false,
  );
});

test("concurrent builds both persist and removal is limited to the builder", async (t) => {
  const { app, dir } = await setup(t);
  const a = await builder(app, "Ada"),
    b = await builder(app, "Lin");
  a.send({
    ...place("stone", 2),
    requestId: "hut",
  });
  b.send({
    ...place("glass", 3),
    requestId: "garden",
  });
  const changed = await a.wait(
    (message) => message.type === "blocks" && message.blocks.length === 2,
  );
  const own = changed.blocks.find((block) => block.material === "stone");
  const notOwn = changed.blocks.find((block) => block.material === "glass");
  assert.equal(own.owned, true);
  assert.equal(notOwn.owned, false);
  const file = JSON.parse(
    await readFile(path.join(dir, "test-expedition.json")),
  );
  assert.equal(file.blocks.length, 2);
  a.send({ type: "remove-block", id: notOwn.id, requestId: "deny" });
  await a.wait(
    (message) => message.type === "error" && message.requestId === "deny",
  );
  a.send({ type: "remove-block", id: own.id, requestId: "remove" });
  const removed = await b.wait(
    (message) =>
      message.type === "blocks" &&
      message.blocks.length === 1 &&
      message.blocks[0].id === notOwn.id,
  );
  assert.equal(removed.blocks.length, 1);
  assert.equal(removed.blocks[0].material, "glass");
});

test("free-form messages and signal IDs are rejected, extra text is stripped, and cooldown survives reconnect", async (t) => {
  const { app } = await setup(t);
  const poison = "UNAPPROVED-TEXT";
  const a = await explorer(app, poison),
    b = await explorer(app, "Observer");
  a.send({ type: "chat", text: poison });
  await a.wait(
    (m) => m.type === "error" && m.message === "Use a preset signal.",
  );
  a.send({ type: "signal", signal: "__proto__", text: poison });
  await a.wait(
    (m) => m.type === "error" && m.message.includes("preset signals"),
  );
  a.send({ type: "signal", signal: "hello", text: poison, name: poison });
  const hello = await b.wait((m) => m.type === "signal");
  assert.equal(hello.message.signal, "hello");
  assert.equal(JSON.stringify(hello).includes(poison), false);
  assert.equal(JSON.stringify(a.welcome).includes(poison), false);
  a.send({ type: "signal", signal: "here" });
  await a.wait(
    (m) => m.type === "error" && m.message.includes("signaling again"),
  );
  a.socket.close();
  await b.wait((m) => m.type === "departure" && m.id === a.welcome.id);
  const resumed = await explorer(app, poison, "test-expedition", {
    token: a.welcome.token,
  });
  resumed.send({ type: "signal", signal: "follow" });
  await resumed.wait(
    (m) => m.type === "error" && m.message.includes("signaling again"),
  );
  assert.equal(app.rooms.get("test-expedition").signals.length, 1);
});

test("legacy marker text and unexpected saved block text never enter a welcome or a new saved block", async (t) => {
  const { app, dir } = await setup(t),
    poison = "UNAPPROVED-TEXT";
  const old = { id: "old-marker", label: poison, note: poison, author: poison };
  await writeFile(
    path.join(dir, "legacy-room.json"),
    JSON.stringify({ version: WORLD_VERSION, marks: [old] }),
  );
  const a = await explorer(app, poison, "legacy-room", BUILD_HOME);
  assert.equal(JSON.stringify(a.welcome).includes(poison), false);
  a.send({
    ...place(),
    label: poison,
    note: poison,
    name: poison,
    requestId: "new-block",
  });
  const saved = await a.wait((m) => m.type === "blocks");
  assert.equal(JSON.stringify(saved).includes(poison), false);
  const stored = JSON.parse(await readFile(path.join(dir, "legacy-room.json")));
  assert.deepEqual(
    stored.legacyMarks,
    [old],
    "retain the earlier data without broadcasting it",
  );
  assert.equal(JSON.stringify(stored.blocks).includes(poison), false);
  stored.blocks[0].label =
    stored.blocks[0].note =
    stored.blocks[0].author =
      poison;
  await writeFile(path.join(dir, "legacy-room.json"), JSON.stringify(stored));
  const reloaded = await createFracticalServer({ port: 0, dataDir: dir });
  t.after(() => reloaded.close());
  const sanitized = await explorer(
    reloaded,
    "Reader",
    "legacy-room",
    BUILD_HOME,
  );
  assert.equal(JSON.stringify(sanitized.welcome).includes(poison), false);
  assert.equal(sanitized.welcome.blocks.length, 1);
});

test("block placement respects reach, explorers, overlap, and server movement and growth collisions", async (t) => {
  const { app } = await setup(t);
  const a = await builder(app, "Builder"),
    b = await builder(app, "Observer");
  a.send({ ...place("stone", 0), requestId: "body" });
  await a.wait((m) => m.type === "error" && m.requestId === "body");
  await new Promise((r) => setTimeout(r, 140));
  a.send({ ...place("stone", 10), requestId: "far" });
  await a.wait((m) => m.type === "error" && m.requestId === "far");
  await new Promise((r) => setTimeout(r, 140));
  a.send({ ...place(), requestId: "wall" });
  const saved = await a.wait((m) => m.type === "blocks");
  const wall = saved.blocks[0],
    collider = new WorldCollider(new FractalCollider(), saved.blocks);
  a.send({
    type: "move",
    ...blockPosition(wall),
    moving: true,
    heading: Math.PI,
  });
  const stopped = await a.wait((m) => m.type === "position");
  assert.ok(stopped.x < wall.x);
  assert.equal(collider.fits(stopped), true);
  a.clear();
  a.send({ ...stopped, type: "move", depth: 0 });
  const grown = await a.wait((m) => m.type === "position");
  assert.ok(grown.depth > 0);
  assert.equal(grown.x, stopped.x);
  assert.equal(grown.y, stopped.y);
  assert.equal(collider.fits(grown), true);
  b.send({ ...place("glass"), requestId: "occupied" });
  await b.wait((m) => m.type === "error" && m.requestId === "occupied");
  assert.equal(app.rooms.get("test-expedition").blocks.length, 1);
});

test("blocks, generated identities, and ownership survive a full server restart", async (t) => {
  const dir = await mkdtemp(path.join(qaRoot, "restart-"));
  let app = await createFracticalServer({ port: 0, dataDir: dir });
  t.after(async () => {
    await app.close();
    await removeOwnedQaDirectory(dir);
  });
  const a = await builder(app, "Ada");
  a.send({
    ...place("glow"),
    requestId: "persist",
  });
  const saved = await a.wait((message) => message.type === "blocks");
  const id = saved.blocks[0].id;
  const token = a.welcome.token;
  await app.close();
  app = await createFracticalServer({ port: 0, dataDir: dir });
  const resumed = await explorer(app, "Arbitrary name", "test-expedition", {
    ...BUILD_HOME,
    token,
  });
  assert.equal(resumed.welcome.token, token);
  assert.equal(resumed.welcome.blocks[0].id, id);
  assert.equal(resumed.welcome.blocks[0].owned, true);
  assert.equal(resumed.welcome.players[0].name, a.welcome.players[0].name);
  resumed.send({ type: "remove-block", id, requestId: "after-restart" });
  const removed = await resumed.wait((message) => message.type === "blocks");
  assert.equal(removed.blocks.length, 0);
});

test("invalid updates and forged cross-origin connections are rejected", async (t) => {
  const { app } = await setup(t);
  const a = await explorer(app, "Ada");
  a.send({ type: "move", x: 900, y: 0, depth: 99 });
  a.send({
    ...place("unknown"),
    requestId: "invalid-kind",
  });
  await a.wait(
    (message) =>
      message.type === "error" && message.requestId === "invalid-kind",
  );
  const snapshot = await a.wait((message) => message.type === "players");
  assert.equal(snapshot.players[0].x, HOME.x);
  const attack = new WebSocket(app.url.replace("http:", "ws:") + "/live", {
    origin: "https://another-origin.invalid",
  });
  await new Promise((resolve, reject) => {
    attack.once("error", resolve);
    attack.once("open", () =>
      reject(new Error("Cross-origin handshake accepted")),
    );
  });
  const response = await fetch(app.url + "/server.mjs");
  assert.equal(response.status, 404);
});

test("32 simultaneous explorers share the latest state and the next join is refused", async (t) => {
  const { app } = await setup(t);
  const explorers = await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      explorer(app, `Explorer ${index}`, "test-expedition", {
        x: -2.5,
        y: 0.5,
        depth: 4,
      }),
    ),
  );
  assert.equal(new Set(explorers.map((client) => client.welcome.id)).size, 32);
  const observer = explorers[0];
  observer.clear();
  for (let index = 0; index < explorers.length; index++)
    explorers[index].send({
      type: "move",
      x: -2.5 + (index + 1) * 0.0001,
      y: 0.5,
      depth: 4,
      moving: true,
    });
  const shared = await observer.wait(
    (message) =>
      message.type === "players" &&
      message.players.length === 32 &&
      message.players.every((player) => player.moving),
  );
  assert.equal(new Set(shared.players.map((player) => player.x)).size, 32);
  const extra = new WebSocket(app.url.replace("http:", "ws:") + "/live");
  const closed = new Promise((resolve) =>
    extra.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString() }),
    ),
  );
  await new Promise((resolve, reject) => {
    extra.once("open", resolve);
    extra.once("error", reject);
  });
  extra.send(
    JSON.stringify({
      type: "join",
      room: "test-expedition",
      name: "One too many",
      ...HOME,
    }),
  );
  assert.deepEqual(await closed, { code: 1008, reason: "Room full" });
  assert.equal(app.rooms.get("test-expedition").players.size, 32);
});

test("the server stops terrain penetration and growth inside the narrowing passage", async (t) => {
  const { app } = await setup(t);
  const a = await explorer(app, "Ada"),
    b = await explorer(app, "Lin");
  const collider = new FractalCollider();
  a.send({ type: "move", ...PASSAGE, depth: HOME.depth, moving: true });
  const stopped = await a.wait((m) => m.type === "position");
  assert.ok(stopped.y > PASSAGE.y + 0.01);
  assert.equal(collider.fits(stopped), true);
  a.clear();
  b.clear();
  a.send({ type: "travel", ...PASSAGE });
  await b.wait(
    (m) =>
      m.type === "players" &&
      m.players.some(
        (p) =>
          p.id === a.welcome.id &&
          p.y === PASSAGE.y &&
          p.depth === PASSAGE.depth,
      ),
  );
  a.send({ type: "move", ...PASSAGE, depth: HOME.depth });
  const grown = await a.wait((m) => m.type === "position");
  assert.ok(grown.depth > HOME.depth && grown.depth < PASSAGE.depth);
  assert.equal(grown.x, PASSAGE.x);
  assert.equal(grown.y, PASSAGE.y);
  assert.equal(collider.fits(grown), true);
  a.clear();
  a.send({ type: "travel", x: 0, y: 0, depth: 18 });
  const refused = await a.wait((m) => m.type === "position");
  assert.equal(refused.x, PASSAGE.x);
  assert.equal(refused.y, PASSAGE.y);
});

test("a failed disk write never announces a block or leaves its reserved collider behind", async (t) => {
  const { app, dir } = await setup(t);
  const a = await builder(app, "Ada"),
    b = await builder(app, "Lin");
  // A directory at the destination file makes the atomic rename fail without changing permissions.
  await (
    await import("node:fs/promises")
  ).mkdir(path.join(dir, "test-expedition.json"));
  a.send({
    ...place(),
    requestId: "disk-error",
  });
  await a.wait(
    (message) => message.type === "error" && message.requestId === "disk-error",
  );
  assert.equal(app.rooms.get("test-expedition").blocks.length, 0);
  assert.equal(
    app.rooms.get("test-expedition").collider.fits(blockPosition(place())),
    true,
  );
  assert.equal(
    b.messages.some((message) => message.type === "blocks"),
    false,
  );
  assert.equal(
    (await readdir(dir)).some((file) => file.endsWith(".tmp")),
    false,
  );
});

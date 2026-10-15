import http from "node:http";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  access,
} from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  HOME,
  COLORS,
  WORLD_VERSION,
  validPosition,
  roomName,
  explorerName,
  motionBetween,
  SIGNALS,
  SIGNAL_COOLDOWN_MS,
} from "./public/world.mjs";
import {
  FractalCollider,
  bodyRadiusAt,
  findClearSpawn,
  moveBody,
  resizeBody,
} from "./public/physics.mjs";
import {
  MATERIALS,
  MAX_BLOCKS,
  BLOCK_COOLDOWN_MS,
  WorldCollider,
  validCell,
  blockPosition,
  placementProblem,
  movementProblem,
  withinBuildReach,
} from "./public/building.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.join(ROOT, "_site");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};
const MAX_PLAYERS = 32;
const RESUME_TTL = 10 * 60_000;

export async function createFracticalServer({
  dataDir = path.join(ROOT, ".local"),
  host = "127.0.0.1",
  port = 4173,
  allowRemote = false,
} = {}) {
  await mkdir(dataDir, { recursive: true });
  const rooms = new Map();
  const loading = new Map();
  const sessions = new Map();
  const collider = new FractalCollider({ maxCells: 120000 });
  const hashToken = (token) => createHash("sha256").update(token).digest("hex");
  async function getRoom(name) {
    if (rooms.has(name)) return rooms.get(name);
    if (loading.has(name)) return loading.get(name);
    if (rooms.size + loading.size >= 128)
      throw new Error("The server has reached its room limit.");
    const pending = (async () => {
      let blocks = [],
        legacyMarks = [];
      try {
        const stored = JSON.parse(
          await readFile(path.join(dataDir, `${name}.json`), "utf8"),
        );
        if (
          stored.version !== WORLD_VERSION ||
          ![stored.blocks, stored.marks, stored.legacyMarks].some(Array.isArray)
        )
          throw new Error("Unrecognized world file.");
        blocks = (Array.isArray(stored.blocks) ? stored.blocks : [])
          .filter(
            (block) =>
              validCell(block) &&
              typeof block.material === "string" &&
              Object.hasOwn(MATERIALS, block.material) &&
              typeof block.id === "string" &&
              /^[0-9a-f-]{36}$/.test(block.id) &&
              typeof block.owner === "string" &&
              /^[0-9a-f]{64}$/.test(block.owner),
          )
          .slice(-MAX_BLOCKS)
          .map(({ id, ix, iy, depth, material, owner, created }) => ({
            id,
            ix,
            iy,
            depth,
            material,
            owner,
            created: Number.isFinite(created) ? created : 0,
            ...blockPosition({ ix, iy, depth }),
          }));
        // Keep old marker records on disk without exposing their free-form text.
        legacyMarks = Array.isArray(stored.legacyMarks)
          ? stored.legacyMarks
          : Array.isArray(stored.marks)
            ? stored.marks
            : [];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const room = {
        name,
        blocks,
        legacyMarks,
        collider: new WorldCollider(collider, blocks),
        players: new Map(),
        signals: [],
        saving: Promise.resolve(),
        dirty: true,
        lastUsed: Date.now(),
      };
      rooms.set(name, room);
      return room;
    })();
    loading.set(name, pending);
    try {
      return await pending;
    } finally {
      loading.delete(name);
    }
  }
  function persist(room, blocks) {
    const body = JSON.stringify(
      {
        version: WORLD_VERSION,
        blocks,
        ...(room.legacyMarks.length ? { legacyMarks: room.legacyMarks } : {}),
      },
      null,
      2,
    );
    const target = path.join(dataDir, `${room.name}.json`);
    const operation = room.saving.then(async () => {
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, body, { mode: 0o600 });
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    });
    room.saving = operation.catch(() => {});
    return operation;
  }
  const send = (socket, message) => {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 256_000)
      socket.send(JSON.stringify(message));
  };
  const broadcast = (room, message) => {
    for (const player of room.players.values()) send(player.socket, message);
  };
  const publicPlayer = (player) => ({
    id: player.id,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
    depth: player.depth,
    heading: player.heading,
    moving: player.moving,
    updated: player.updated,
  });
  const errorMessage = (socket, message, requestId) =>
    send(socket, { type: "error", message, requestId });

  const server = http.createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    );
    try {
      const url = new URL(
        request.url,
        `http://${request.headers.host || "localhost"}`,
      );
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405);
        response.end();
        return;
      }
      if (url.pathname === "/health") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            ok: true,
            version: WORLD_VERSION,
            rooms: rooms.size,
            players: [...rooms.values()].reduce(
              (sum, room) => sum + room.players.size,
              0,
            ),
          }),
        );
        return;
      }
      const relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname).slice(1);
      const target = path.resolve(FRONTEND_ROOT, relative);
      const publicRoot = FRONTEND_ROOT + path.sep;
      if (!target.startsWith(publicRoot) || !MIME[path.extname(target)]) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      const content = await readFile(target);
      response.setHeader("Content-Type", MIME[path.extname(target)]);
      response.setHeader("Cache-Control", "no-cache");
      response.writeHead(200);
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 400);
      response.end("Not found");
    }
  });
  server.maxHeadersCount = 100;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host}`);
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== "/live") {
      socket.destroy();
      return;
    }
    // Browser handshakes must come from this origin. Native test clients have no Origin.
    if (request.headers.origin) {
      try {
        if (new URL(request.headers.origin).host !== request.headers.host) {
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    } else if (
      allowRemote &&
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        request.socket.remoteAddress,
      )
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) =>
      wss.emit("connection", ws, request),
    );
  });
  wss.on("connection", (socket) => {
    let player = null;
    let room = null;
    let joining = false;
    let queue = Promise.resolve();
    let budget = 60;
    let budgetAt = Date.now();
    let lastBuild = 0;
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    socket.on("error", () => {});
    const joinTimeout = setTimeout(() => {
      if (!player) socket.close(1008, "Join an expedition first.");
    }, 10_000);
    joinTimeout.unref();
    socket.on("message", (buffer, binary) => {
      if (binary) {
        socket.close(1003, "Text messages only.");
        return;
      }
      const now = Date.now();
      budget = Math.min(60, budget + (now - budgetAt) * 0.035);
      budgetAt = now;
      if (budget < 1) {
        socket.close(1008, "Too many messages.");
        return;
      }
      budget--;
      let message;
      try {
        message = JSON.parse(buffer.toString());
      } catch {
        errorMessage(socket, "That message could not be read.");
        return;
      }
      if (!message || typeof message !== "object") return;
      queue = queue
        .then(async () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (message.type === "join") {
            if (player || joining) return;
            const name = roomName(message.room);
            if (!name) {
              errorMessage(
                socket,
                "Use a room name with letters, numbers, and hyphens.",
              );
              return;
            }
            joining = true;
            try {
              room = await getRoom(name);
              if (socket.readyState !== WebSocket.OPEN) return;
              if (room.players.size >= MAX_PLAYERS) {
                errorMessage(socket, "This expedition is full (32 explorers).");
                socket.close(1008, "Room full");
                return;
              }
              const resume =
                typeof message.token === "string" && message.token.length === 48
                  ? sessions.get(hashToken(message.token))
                  : null;
              const reusable =
                resume &&
                resume.room === name &&
                resume.expires > Date.now() &&
                !room.players.has(resume.id);
              const token =
                typeof message.token === "string" &&
                /^[0-9a-f]{48}$/.test(message.token)
                  ? message.token
                  : randomBytes(24).toString("hex");
              const color = COLORS.includes(message.color)
                ? message.color
                : COLORS[room.players.size % COLORS.length];
              const position =
                findClearSpawn(
                  validPosition(message) ? message : HOME,
                  room.collider,
                ) || findClearSpawn(HOME, room.collider);
              if (!position) {
                errorMessage(
                  socket,
                  "There is no clear arrival space in this expedition.",
                );
                socket.close(1008, "No arrival space");
                return;
              }
              player = {
                id: reusable ? resume.id : randomUUID(),
                name: explorerName(hashToken(token)),
                color,
                x: position.x,
                y: position.y,
                depth: position.depth,
                heading: 0,
                moving: false,
                updated: Date.now(),
                socket,
                tokenHash: hashToken(token),
              };
              sessions.set(player.tokenHash, {
                id: player.id,
                room: name,
                expires: Date.now() + RESUME_TTL,
                lastSignalAt: resume?.lastSignalAt || 0,
              });
              room.players.set(player.id, player);
              room.lastUsed = Date.now();
              room.dirty = true;
              clearTimeout(joinTimeout);
              send(socket, {
                type: "welcome",
                id: player.id,
                token,
                worldVersion: WORLD_VERSION,
                room: name,
                players: [...room.players.values()].map(publicPlayer),
                blocks: publicBlocks(room, player),
                signals: room.signals,
                maxPlayers: MAX_PLAYERS,
                maxBlocks: MAX_BLOCKS,
              });
              broadcast(room, {
                type: "arrival",
                player: publicPlayer(player),
              });
            } finally {
              joining = false;
            }
            return;
          }
          if (!player || !room) return;
          room.lastUsed = Date.now();
          if (message.type === "move" && validPosition(message)) {
            const smaller = resizeBody(
              player,
              Math.max(player.depth, message.depth),
              room.collider,
            );
            const moved = moveBody(
              smaller,
              { x: message.x - player.x, y: message.y - player.y },
              room.collider,
            );
            const sized = resizeBody(moved, message.depth, room.collider);
            const motion = motionBetween(player, sized);
            motion.moving &&= Boolean(message.moving);
            room.dirty ||=
              player.x !== sized.x ||
              player.y !== sized.y ||
              player.depth !== sized.depth ||
              player.moving !== motion.moving;
            player.x = sized.x;
            player.y = sized.y;
            player.depth = sized.depth;
            if (
              Math.hypot(player.x - message.x, player.y - message.y) >
                bodyRadiusAt(player.depth) * 0.005 ||
              Math.abs(player.depth - message.depth) > 0.0001
            )
              send(socket, {
                type: "position",
                x: player.x,
                y: player.y,
                depth: player.depth,
              });
            player.heading = motion.heading;
            player.moving = motion.moving;
            player.updated = Date.now();
          } else if (message.type === "travel" && validPosition(message)) {
            if (room.collider.fits(message)) {
              player.x = message.x;
              player.y = message.y;
              player.depth = message.depth;
              player.moving = false;
              player.updated = Date.now();
              room.dirty = true;
            } else
              send(socket, {
                type: "position",
                x: player.x,
                y: player.y,
                depth: player.depth,
              });
          } else if (message.type === "profile") {
            if (COLORS.includes(message.color)) player.color = message.color;
            broadcast(room, {
              type: "players",
              players: [...room.players.values()].map(publicPlayer),
              at: Date.now(),
            });
          } else if (message.type === "chat") {
            errorMessage(socket, "Use a preset signal.");
          } else if (message.type === "signal" || message.type === "wave") {
            const signal = message.type === "wave" ? "hello" : message.signal;
            if (typeof signal !== "string" || !Object.hasOwn(SIGNALS, signal)) {
              errorMessage(socket, "Choose one of the preset signals.");
              return;
            }
            const session = sessions.get(player.tokenHash);
            if (
              Date.now() - (session?.lastSignalAt || 0) <
              SIGNAL_COOLDOWN_MS
            ) {
              errorMessage(socket, "Wait a moment before signaling again.");
              return;
            }
            session.lastSignalAt = Date.now();
            const sent = {
              id: randomUUID(),
              playerId: player.id,
              name: player.name,
              color: player.color,
              signal,
              at: Date.now(),
            };
            room.signals.push(sent);
            room.signals = room.signals.slice(-60);
            broadcast(room, { type: "signal", message: sent });
          } else if (message.type === "place-block") {
            if (
              typeof message.material !== "string" ||
              !Object.hasOwn(MATERIALS, message.material) ||
              !validCell(message)
            ) {
              errorMessage(
                socket,
                "Choose a block material and a valid cell.",
                message.requestId,
              );
              return;
            }
            if (Date.now() - lastBuild < BLOCK_COOLDOWN_MS) {
              errorMessage(
                socket,
                "Wait a moment before placing another block.",
                message.requestId,
              );
              return;
            }
            if (room.blocks.length >= MAX_BLOCKS) {
              errorMessage(
                socket,
                "This expedition has 1,024 blocks. Remove one of yours to make room.",
                message.requestId,
              );
              return;
            }
            lastBuild = Date.now();
            const block = {
              id: randomUUID(),
              ix: message.ix,
              iy: message.iy,
              depth: message.depth,
              ...blockPosition(message),
              material: message.material,
              owner: player.tokenHash,
              created: Date.now(),
            };
            // Room operations are serialized across sockets, so simultaneous edits cannot overwrite each other.
            const operation = room.mutation || Promise.resolve();
            const mutation = operation
              .catch(() => {})
              .then(async () => {
                if (room.blocks.length >= MAX_BLOCKS) {
                  errorMessage(
                    socket,
                    "This expedition has reached its block limit.",
                    message.requestId,
                  );
                  return;
                }
                const problem = placementProblem(
                  block,
                  player,
                  [...room.players.values()],
                  room.blocks,
                  collider,
                );
                if (problem) {
                  errorMessage(socket, problem, message.requestId);
                  return;
                }
                const next = [...room.blocks, block];
                // Reserve the cell while saving so another explorer cannot walk
                // into a block between validation and its publication.
                room.collider.setBlocks(next);
                try {
                  await persist(room, next);
                } catch (error) {
                  room.collider.setBlocks(room.blocks);
                  throw error;
                }
                room.blocks = next;
                broadcastBlocks(room, message.requestId, player.id);
              });
            room.mutation = mutation;
            await mutation;
          } else if (message.type === "move-block") {
            if (!validCell(message) || !validCell(message.from)) {
              errorMessage(
                socket,
                "Choose a valid square and destination.",
                message.requestId,
              );
              return;
            }
            if (Date.now() - lastBuild < BLOCK_COOLDOWN_MS) {
              errorMessage(
                socket,
                "Wait a moment before moving another square.",
                message.requestId,
              );
              return;
            }
            lastBuild = Date.now();
            const operation = room.mutation || Promise.resolve();
            const mutation = operation
              .catch(() => {})
              .then(async () => {
                const block = room.blocks.find(
                  (item) => item.id === message.id,
                );
                if (!block || !equalHashes(block.owner, player.tokenHash)) {
                  errorMessage(
                    socket,
                    "You can only move your own squares.",
                    message.requestId,
                  );
                  return;
                }
                if (
                  ["ix", "iy", "depth"].some(
                    (key) => block[key] !== message.from[key],
                  )
                ) {
                  errorMessage(
                    socket,
                    "That square has changed. Pick it up again.",
                    message.requestId,
                  );
                  return;
                }
                const problem = movementProblem(
                  block,
                  message,
                  player,
                  [...room.players.values()],
                  room.blocks,
                  collider,
                );
                if (problem) {
                  errorMessage(socket, problem, message.requestId);
                  return;
                }
                const moved = {
                  ...block,
                  ix: message.ix,
                  iy: message.iy,
                  ...blockPosition(message),
                };
                const next = room.blocks.map((item) =>
                  item.id === block.id ? moved : item,
                );
                // Keep both footprints solid until the save succeeds. A failed
                // write must not restore the old square on top of an explorer.
                room.collider.setBlocks([...room.blocks, moved]);
                try {
                  await persist(room, next);
                } catch (error) {
                  room.collider.setBlocks(room.blocks);
                  throw error;
                }
                room.blocks = next;
                room.collider.setBlocks(next);
                broadcastBlocks(room, message.requestId, player.id);
              });
            room.mutation = mutation;
            await mutation;
          } else if (message.type === "remove-block") {
            const operation = room.mutation || Promise.resolve();
            const mutation = operation
              .catch(() => {})
              .then(async () => {
                const block = room.blocks.find(
                  (item) => item.id === message.id,
                );
                if (!block || !equalHashes(block.owner, player.tokenHash)) {
                  errorMessage(
                    socket,
                    "You can only remove your own blocks.",
                    message.requestId,
                  );
                  return;
                }
                if (!withinBuildReach(block, player)) {
                  errorMessage(
                    socket,
                    "Walk closer. Remove blocks at their own scale.",
                    message.requestId,
                  );
                  return;
                }
                const next = room.blocks.filter((item) => item.id !== block.id);
                await persist(room, next);
                room.blocks = next;
                room.collider.setBlocks(next);
                broadcastBlocks(room, message.requestId, player.id);
              });
            room.mutation = mutation;
            await mutation;
          } else if (message.type === "ping")
            send(socket, { type: "pong", at: message.at });
        })
        .catch((error) => {
          console.error("Room operation failed:", error.message);
          errorMessage(
            socket,
            "The server could not save that change. Try again.",
            message.requestId,
          );
        });
    });
    socket.on("close", () => {
      clearTimeout(joinTimeout);
      if (player && room) {
        room.players.delete(player.id);
        room.dirty = true;
        sessions.set(player.tokenHash, {
          id: player.id,
          room: room.name,
          expires: Date.now() + RESUME_TTL,
          lastSignalAt: sessions.get(player.tokenHash)?.lastSignalAt || 0,
        });
        broadcast(room, { type: "departure", id: player.id });
      }
    });
  });
  function equalHashes(a, b) {
    return (
      typeof a === "string" &&
      typeof b === "string" &&
      a.length === b.length &&
      timingSafeEqual(Buffer.from(a), Buffer.from(b))
    );
  }
  function publicBlocks(room, player) {
    return room.blocks.map(({ owner, ...block }) => ({
      ...block,
      author: explorerName(owner),
      owned: equalHashes(player.tokenHash, owner),
    }));
  }
  function broadcastBlocks(room, requestId, requester) {
    for (const player of room.players.values())
      send(player.socket, {
        type: "blocks",
        blocks: publicBlocks(room, player),
        ...(player.id === requester ? { requestId } : {}),
      });
  }
  const snapshots = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.players.size && room.dirty) {
        broadcast(room, {
          type: "players",
          players: [...room.players.values()].map(publicPlayer),
          at: Date.now(),
        });
        room.dirty = false;
      }
    }
  }, 80);
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) socket.terminate();
      else {
        socket.isAlive = false;
        socket.ping();
      }
    }
    for (const [token, session] of sessions)
      if (
        session.expires < Date.now() &&
        ![...rooms.values()].some((room) =>
          [...room.players.values()].some(
            (player) => player.tokenHash === token,
          ),
        )
      )
        sessions.delete(token);
    for (const [name, room] of rooms)
      if (!room.players.size && Date.now() - room.lastUsed > RESUME_TTL)
        rooms.delete(name);
  }, 15_000);
  snapshots.unref();
  heartbeat.unref();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    server,
    wss,
    rooms,
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${address.port}`,
    async close() {
      clearInterval(snapshots);
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await Promise.allSettled(
        [...rooms.values()].map((room) => room.mutation || room.saving),
      );
      await new Promise((resolve) => wss.close(resolve));
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await access(path.join(FRONTEND_ROOT, "index.html"));
  } catch {
    console.error(
      "Build the frontend with npm run build before npm start, or use npm run dev.",
    );
    process.exit(1);
  }
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 4173);
  const app = await createFracticalServer({
    host,
    port,
    dataDir: process.env.FRACTICAL_DATA_DIR || path.join(ROOT, ".local"),
    allowRemote: host !== "127.0.0.1",
  });
  console.log(`Fractical: ${app.url}`);
  console.log(
    `Live expeditions: /live | Persistent blocks: ${process.env.FRACTICAL_DATA_DIR || path.join(ROOT, ".local")}`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      app.close().then(() => process.exit(0));
    });
}

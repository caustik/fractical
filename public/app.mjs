import {
  HOME,
  PLACES,
  COLORS,
  MAX_DEPTH,
  spanAt,
  clamp,
  readPosition,
  roomName,
  motionBetween,
  SIGNALS,
  SIGNAL_COOLDOWN_MS,
} from "./world.mjs";
import { Terrain } from "./terrain.mjs";
import { Entities } from "./entities.mjs";
import { FieldSound } from "./sound.mjs";
import {
  FractalCollider,
  PASSAGE,
  bodyRadiusAt,
  findClearSpawn,
  moveBody,
  resizeBody,
} from "./physics.mjs";
import {
  MATERIALS,
  blockSizeAt,
  blockPosition,
  cellAt,
  WorldCollider,
  placementProblem,
  movementProblem,
  pickBlock,
  withinBuildReach,
  blockClusters,
} from "./building.mjs";

const $ = (id) => document.getElementById(id);
const h = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
// randomUUID requires a secure context; getRandomValues also works for a LAN preview.
const requestId = () =>
  crypto.randomUUID?.() ||
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
const params = new URLSearchParams(location.search);
const room = roomName(params.get("room")) || "common";
let profile;
try {
  profile = JSON.parse(storage.get("fractical.profile")) || {};
} catch {
  profile = {};
}
profile = {
  color: COLORS.includes(profile.color)
    ? profile.color
    : COLORS[Math.floor(Math.random() * COLORS.length)],
};
storage.set("fractical.profile", JSON.stringify(profile));
let token = storage.get(`fractical.token.${room}`) || "";
const terrainCollider = new FractalCollider();
const collider = new WorldCollider(terrainCollider);
const initialPosition = findClearSpawn(readPosition(params), collider) || HOME;
const me = {
  ...initialPosition,
  id: "local",
  name: "Explorer",
  color: profile.color,
  heading: 0,
  moving: false,
};
const camera = { x: me.x, y: me.y, depth: me.depth };
let others = new Map(),
  blocks = [],
  socket,
  online = false,
  serverNeedsRestart = false,
  reconnectCount = 0,
  reconnectTimer;
let destination = null,
  followed = null,
  lastSent = 0,
  lastFrame = performance.now(),
  lastUi = 0,
  lastTerrain = 0;
let lastPosition = null,
  terrainWasDrawn = false,
  frameCosts = [],
  lastQualityChange = 0;
let currentPlace = params.has("x")
  ? "Somewhere worth sharing"
  : "The narrowing passage";
let contactState = "",
  contactUntil = 0;
let pendingBuild = null,
  buildTimer = null;
let buildMode = null,
  material = "stone",
  buildPointer = null;
let selectedBlock = null,
  blockDrag = null,
  pointerStart = null;
let signalReadyAt = 0,
  signalTimer;
let unreadRadio = 0;
const keys = new Set(),
  waves = new Map(),
  bubbles = new Map();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let touchVector = { x: 0, y: 0 };
const world = $("world");
const terrain = new Terrain($("terrain"), (text) => {
  $("render-notice").textContent = text;
  $("render-notice").hidden = !text;
});
const entities = new Entities($("entities"));
const sound = new FieldSound();
world.dataset.renderer = terrain.mode;
$("render-mode").textContent =
  terrain.mode === "webgl2" ? "live procedural terrain" : "light terrain mode";
$("room-caption").textContent = `EXPEDITION / ${room.toUpperCase()}`;
$("explorer-name").textContent = me.name;
const resize = () => {
  const rect = world.getBoundingClientRect();
  terrain.resize(rect.width, rect.height);
  entities.resize(rect.width, rect.height);
};
new ResizeObserver(resize).observe(world);
resize();

let toastTimer;
function toast(message, duration = 3400) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, duration);
}
function openTab(name, mobileToggle = false) {
  const sidebar = document.querySelector(".fieldnotes");
  if (
    mobileToggle &&
    innerWidth <= 700 &&
    document
      .querySelector(`[data-tab="${name}"]`)
      .getAttribute("aria-selected") === "true"
  )
    sidebar.classList.toggle("expanded");
  else if (innerWidth <= 700) sidebar.classList.add("expanded");
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(selected));
    $(`${tab.dataset.tab}-panel`).hidden = !selected;
  }
}
for (const tab of document.querySelectorAll("[data-tab]"))
  tab.addEventListener("click", () => openTab(tab.dataset.tab, true));
document.querySelector(".tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll("[data-tab]")],
    index = tabs.indexOf(document.activeElement);
  const next =
    tabs[(index + (event.key === "ArrowRight" ? 1 : 2)) % tabs.length];
  event.preventDefault();
  next.focus();
  openTab(next.dataset.tab);
});
function stopFollowing(announce = false) {
  if (followed) currentPlace = "Along the Mandelbrot coast";
  if (followed && announce) toast("Walking on your own again.");
  followed = null;
  $("follow-banner").hidden = true;
}
function go(place, title = place.name || place.label || "An uncharted place") {
  const landing = findClearSpawn(
    { x: place.x, y: place.y, depth: clamp(place.depth, 0, MAX_DEPTH) },
    collider,
  );
  if (!landing) {
    toast("There is no clear ground near that address.");
    return;
  }
  stopFollowing();
  setBuildMode(null);
  buildPointer = null;
  destination = null;
  keys.clear();
  touchVector = { x: 0, y: 0 };
  Object.assign(me, {
    ...landing,
    moving: false,
  });
  // Long-distance travel is a deliberate jump, not a flight through unrelated scales.
  Object.assign(camera, { x: me.x, y: me.y, depth: me.depth });
  terrain.last = null;
  currentPlace = title;
  $("intro-hint").hidden = true;
  if (innerWidth <= 700)
    document.querySelector(".fieldnotes").classList.remove("expanded");
  send({ type: "travel", x: me.x, y: me.y, depth: me.depth });
  lastPosition = null;
  updateLabels();
  world.focus({ preventScroll: true });
}
for (const place of PLACES) {
  const button = h("button", "place-card");
  button.setAttribute("aria-label", `Visit ${place.name}`);
  const thumb = h("span", "place-thumb");
  thumb.setAttribute("aria-hidden", "true");
  thumb.append(h("span", "", "◎"));
  const copy = h("span", "place-copy");
  copy.append(
    h("strong", "", place.name),
    h(
      "small",
      "",
      `DEPTH ${place.depth.toFixed(1).padStart(4, "0")} / ${Math.round(2 ** place.depth).toLocaleString()}×`,
    ),
  );
  button.append(thumb, copy, h("span", "place-arrow", "↗"));
  button.title = place.description;
  button.addEventListener("click", () => {
    go(place);
    toast(place.description);
  });
  $("places-list").append(button);
}
$("atlas-button").addEventListener("click", () =>
  go({ x: -0.55, y: 0, depth: 0 }, "The whole Mandelbrot world"),
);
$("home-button").addEventListener("click", () =>
  go(HOME, "The narrowing passage"),
);
$("passage-button").addEventListener("click", () => {
  go(HOME, "The narrowing passage");
  destination = { x: PASSAGE.x, y: PASSAGE.y };
});
$("unfollow-button").addEventListener("click", () => stopFollowing(true));
$("dismiss-hint").addEventListener("click", () => {
  $("intro-hint").hidden = true;
});

function setConnection(connected, label) {
  online = connected;
  $("connection").textContent = label;
  $("status-dot").classList.toggle("connected", connected);
  const badgeDot = document.querySelector(".live-badge .status-dot");
  badgeDot.style.background = connected ? "#a5d6bc" : "#aa9d75";
  $("build-button").disabled = !connected;
  $("build-from-list").disabled = !connected;
  updateSignalControls();
  if (!connected) setBuildMode(null);
  world.dataset.connected = String(connected);
  updateCounts();
}
function send(message) {
  if (
    socket?.readyState !== WebSocket.OPEN ||
    !online ||
    socket.bufferedAmount > 32_000
  )
    return false;
  socket.send(JSON.stringify(message));
  return true;
}
function sendPosition(force = false) {
  const now = performance.now();
  if (!force && now - lastSent < 66) return;
  if (
    !force &&
    lastPosition &&
    me.x === lastPosition.x &&
    me.y === lastPosition.y &&
    me.depth === lastPosition.depth &&
    me.moving === lastPosition.moving &&
    now - lastSent < 1500
  )
    return;
  if (
    send({
      type: "move",
      x: me.x,
      y: me.y,
      depth: me.depth,
      moving: me.moving,
    })
  ) {
    lastSent = now;
    lastPosition = { x: me.x, y: me.y, depth: me.depth, moving: me.moving };
  }
}
function connect() {
  clearTimeout(reconnectTimer);
  setConnection(false, reconnectCount ? "reconnecting" : "connecting");
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`,
  );
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        type: "join",
        room,
        token,
        color: profile.color,
        x: me.x,
        y: me.y,
        depth: me.depth,
      }),
    );
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "welcome") {
      if (!Array.isArray(message.blocks) || !Array.isArray(message.signals)) {
        serverNeedsRestart = true;
        setConnection(false, "restart server");
        toast("Restart the Fractical server, then reload this page.", 15000);
        socket.close(1000);
        return;
      }
      const returning = reconnectCount > 0;
      me.id = message.id;
      token = message.token;
      storage.set(`fractical.token.${room}`, token);
      blocks = message.blocks;
      collider.setBlocks(blocks);
      const own = message.players.find((player) => player.id === me.id);
      if (own) {
        Object.assign(me, {
          x: own.x,
          y: own.y,
          depth: own.depth,
          heading: own.heading,
          moving: false,
        });
        Object.assign(camera, { x: own.x, y: own.y, depth: own.depth });
      }
      reconnectCount = 0;
      setConnection(true, "live");
      syncPlayers(message.players);
      renderBlocks();
      $("chat-messages").replaceChildren(
        h("p", "radio-intro", "Send a signal to explore together."),
      );
      for (const signal of message.signals) addSignal(signal, false);
      addSystem(
        returning
          ? "Connection restored. The coast is still here."
          : `You joined ${room}. Invite someone to wander with you.`,
      );
      sendPosition(true);
    } else if (message.type === "position") {
      Object.assign(me, {
        x: message.x,
        y: message.y,
        depth: message.depth,
        moving: false,
      });
      lastPosition = null;
      updateLabels();
    } else if (message.type === "players") syncPlayers(message.players);
    else if (message.type === "arrival") {
      if (message.player.id !== me.id) {
        addSystem(`${message.player.name} arrived.`);
        syncPlayers([...others.values(), message.player, me]);
      }
    } else if (message.type === "departure") {
      const player = others.get(message.id);
      if (player) addSystem(`${player.name} headed out.`);
      others.delete(message.id);
      renderPeople();
      updateCounts();
      if (followed === message.id) {
        stopFollowing();
        toast("Your fellow explorer headed out.");
      }
    } else if (message.type === "signal") addSignal(message.message, true);
    else if (message.type === "blocks") {
      blocks = message.blocks;
      collider.setBlocks(blocks);
      if (
        selectedBlock &&
        !blocks.some(
          (block) =>
            block.id === selectedBlock.id &&
            block.ix === selectedBlock.ix &&
            block.iy === selectedBlock.iy &&
            block.depth === selectedBlock.depth,
        )
      ) {
        cancelBlockMove();
        toast("That square changed. Pick it up again.");
      }
      renderBlocks();
      updateCounts();
      if (pendingBuild && message.requestId === pendingBuild) {
        clearTimeout(buildTimer);
        pendingBuild = null;
        $("build-status").textContent =
          "Saved. Everyone in the expedition can see it.";
      }
    } else if (message.type === "error") {
      toast(message.message, 5500);
      if (message.requestId === pendingBuild) {
        clearTimeout(buildTimer);
        pendingBuild = null;
      }
    } else if (message.type === "pong")
      $("latency").textContent =
        `${Math.max(1, Math.round((performance.now() - message.at) / 2))}ms`;
  });
  socket.addEventListener("close", (event) => {
    setConnection(false, "offline");
    others.clear();
    renderPeople();
    updateCounts();
    stopFollowing();
    if (pendingBuild) {
      clearTimeout(buildTimer);
      pendingBuild = null;
      toast(
        "Disconnected before the edit was confirmed. Reconnect to check your blocks.",
      );
    }
    if (serverNeedsRestart) {
      setConnection(false, "restart server");
      addSystem(
        "The server is running the earlier prototype. Restart it and reload this page.",
      );
      return;
    }
    if (event.code === 1008) {
      addSystem(`Connection paused: ${event.reason}. Reload to retry.`);
      return;
    }
    reconnectCount++;
    reconnectTimer = setTimeout(
      connect,
      Math.min(8000, 600 * 2 ** Math.min(reconnectCount - 1, 4)),
    );
  });
  socket.addEventListener("error", () => {});
}
function syncPlayers(players) {
  const next = new Map();
  for (const player of players) {
    if (player.id === me.id) {
      me.name = player.name;
      $("explorer-name").textContent = me.name;
      continue;
    }
    const existing = others.get(player.id);
    next.set(player.id, {
      ...player,
      renderX: existing?.renderX ?? player.x,
      renderY: existing?.renderY ?? player.y,
      renderDepth: existing?.renderDepth ?? player.depth,
      renderHeading: existing?.renderHeading ?? player.heading,
    });
  }
  const previous = [...others.values()]
    .map((p) => `${p.id}:${p.name}:${p.depth.toFixed(1)}:${p.color}`)
    .join("|");
  others = next;
  const current = [...others.values()]
    .map((p) => `${p.id}:${p.name}:${p.depth.toFixed(1)}:${p.color}`)
    .join("|");
  if (previous !== current) renderPeople();
  updateCounts();
}
function updateCounts() {
  $("people-count").textContent = String(others.size + 1);
  $("blocks-count").textContent = String(blocks.length);
  $("live-caption").textContent = online
    ? `${others.size + 1} explorer${others.size ? "s" : ""} here`
    : "exploring offline";
}
function renderPeople() {
  const list = $("people-list");
  list.replaceChildren();
  if (!others.size) {
    const empty = h("p", "empty-state", "An open invitation.");
    empty.append(
      h(
        "small",
        "",
        "You are the first explorer here. Share your link, or open a second browser to meet yourself.",
      ),
    );
    list.append(empty);
  }
  for (const player of others.values()) {
    const card = h("div", "person-card"),
      top = h("div", "person-top"),
      orb = h("span", "person-orb");
    orb.style.background = player.color;
    top.append(
      orb,
      h("span", "", player.name),
      h("small", "", `DEPTH ${player.depth.toFixed(1)}`),
    );
    const actions = h("div", "person-actions"),
      meet = h("button", "", "Meet here ↗"),
      follow = h(
        "button",
        "",
        followed === player.id ? "Following…" : "Follow",
      );
    meet.setAttribute("aria-label", `Meet ${player.name}`);
    follow.setAttribute("aria-label", `Follow ${player.name}`);
    meet.addEventListener("click", () => {
      const current = others.get(player.id);
      if (current) {
        go(current, `Alongside ${current.name}`);
        toast(`You are at ${current.name}'s place and scale.`);
      }
    });
    follow.addEventListener("click", () => {
      const current = others.get(player.id);
      if (!current) return;
      go(current, `Following ${current.name}`);
      followed = current.id;
      $("follow-caption").textContent = `Following ${current.name}`;
      $("follow-banner").hidden = false;
      toast("Follow their route. Move to walk on your own.");
      renderPeople();
    });
    actions.append(meet, follow);
    card.append(top, actions);
    list.append(card);
  }
}
for (const color of COLORS) {
  const button = h("button");
  button.style.background = color;
  button.setAttribute("aria-label", `Explorer color ${color}`);
  button.setAttribute("aria-pressed", String(color === profile.color));
  button.addEventListener("click", () => {
    profile.color = color;
    me.color = color;
    saveProfile();
    for (const option of $("color-options").children)
      option.setAttribute("aria-pressed", String(option === button));
  });
  $("color-options").append(button);
}
function saveProfile() {
  storage.set("fractical.profile", JSON.stringify(profile));
  send({ type: "profile", color: profile.color });
}
$("wave-button").addEventListener("click", () => sendSignal("hello"));

function renderBlocks() {
  const list = $("blocks-list");
  list.replaceChildren();
  $("build-from-list").textContent = "Build with blocks +";
  if (!blocks.length) {
    const empty = h("p", "empty-state", "Start with one block.");
    empty.append(
      h(
        "small",
        "",
        "Place a few cells together. Make a wall, an opening, or a shape of your own.",
      ),
    );
    list.append(empty);
  }
  for (const group of blockClusters(blocks).reverse()) {
    const card = h("article", "mark-card");
    const title = h(
      "h3",
      "mark-title",
      `${group.length} block${group.length === 1 ? "" : "s"} together`,
    );
    const miniature = h("canvas", "construction-map");
    miniature.width = 180;
    miniature.height = 70;
    miniature.setAttribute("aria-label", "Shape of this construction");
    const minX = Math.min(...group.map((b) => b.ix)),
      maxX = Math.max(...group.map((b) => b.ix));
    const minY = Math.min(...group.map((b) => b.iy)),
      maxY = Math.max(...group.map((b) => b.iy));
    const pixel = Math.min(18, 164 / (maxX - minX + 1), 54 / (maxY - minY + 1));
    const ctx = miniature.getContext("2d");
    const left = (180 - (maxX - minX + 1) * pixel) / 2,
      top = (70 - (maxY - minY + 1) * pixel) / 2;
    for (const block of group) {
      ctx.fillStyle = MATERIALS[block.material].fill;
      ctx.fillRect(
        left + (block.ix - minX) * pixel,
        top + (maxY - block.iy) * pixel,
        pixel - 0.5,
        pixel - 0.5,
      );
    }
    card.append(title, miniature);
    card.append(
      h(
        "p",
        "mark-meta",
        `DEPTH ${group[0].depth} / ${group.filter((b) => b.owned).length} YOURS`,
      ),
    );
    const actions = h("div", "mark-actions"),
      visit = h("button", "", "Visit this place ↗");
    visit.setAttribute(
      "aria-label",
      `Visit this ${group.length}-block construction`,
    );
    visit.addEventListener("click", () =>
      go({ ...group[0], name: "A shared construction" }),
    );
    actions.append(visit);
    card.append(actions);
    list.append(card);
  }
  updateCounts();
}
function addSystem(text) {
  const line = h("p", "chat-line system", text);
  $("chat-messages").append(line);
  trimRadio();
}
function addSignal(message, animate) {
  if (
    typeof message.signal !== "string" ||
    !Object.hasOwn(SIGNALS, message.signal)
  )
    return;
  const text = SIGNALS[message.signal];
  const line = h("p", "chat-line"),
    name = h("strong", "", `${message.name}:`);
  name.style.color = "#486d56";
  line.append(name, document.createTextNode(text));
  $("chat-messages").append(line);
  trimRadio();
  if (animate)
    bubbles.set(message.playerId, {
      text,
      time: performance.now(),
    });
  if (animate && $("chat-body").hidden && message.playerId !== me.id) {
    unreadRadio++;
    document.querySelector(".conversation-heading strong").textContent =
      `Field signals (${unreadRadio})`;
  }
  if (animate && message.signal === "hello")
    waves.set(message.playerId, performance.now());
}
function trimRadio() {
  const log = $("chat-messages");
  while (log.children.length > 64) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}
function updateSignalControls() {
  const disabled = !online || performance.now() < signalReadyAt;
  for (const button of document.querySelectorAll("[data-signal], #wave-button"))
    button.disabled = disabled;
}
function sendSignal(signal) {
  if (!online) {
    toast("Reconnecting to the expedition.");
    return;
  }
  if (performance.now() < signalReadyAt) return;
  if (!send({ type: "signal", signal })) return;
  signalReadyAt = performance.now() + SIGNAL_COOLDOWN_MS;
  updateSignalControls();
  clearTimeout(signalTimer);
  signalTimer = setTimeout(updateSignalControls, SIGNAL_COOLDOWN_MS + 20);
}
for (const [signal, text] of Object.entries(SIGNALS)) {
  const button = h("button", "", text);
  button.type = "button";
  button.dataset.signal = signal;
  button.addEventListener("click", () => sendSignal(signal));
  $("signal-options").append(button);
}
$("chat-toggle").addEventListener("click", () => {
  const collapsed = !$("chat-body").hidden;
  $("chat-body").hidden = collapsed;
  $("chat-toggle").textContent = collapsed ? "+" : "−";
  $("chat-toggle").setAttribute(
    "aria-label",
    `${collapsed ? "Expand" : "Collapse"} field signals`,
  );
  if (!collapsed) {
    unreadRadio = 0;
    document.querySelector(".conversation-heading strong").textContent =
      "Field signals";
    if (innerWidth <= 700) $("intro-hint").hidden = true;
  }
});
if (innerWidth <= 700) {
  $("chat-body").hidden = true;
  $("chat-toggle").textContent = "+";
  $("chat-toggle").setAttribute("aria-label", "Expand field signals");
}

function openDialog(id) {
  keys.clear();
  destination = null;
  me.moving = false;
  touchVector = { x: 0, y: 0 };
  $(id).showModal();
}
for (const button of document.querySelectorAll("[data-close]"))
  button.addEventListener("click", () => $(button.dataset.close).close());
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
  dialog.addEventListener("close", () => {
    keys.clear();
    world.focus({ preventScroll: true });
  });
}
$("about-button").addEventListener("click", () => openDialog("about-dialog"));
$("help-button").addEventListener("click", () => openDialog("help-dialog"));
$("room-button").addEventListener("click", () => {
  $("room-input").value = "";
  openDialog("room-dialog");
});
$("room-input").addEventListener("input", () => {
  $("room-input").value = $("room-input")
    .value.toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-");
});
$("room-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const nextRoom = roomName($("room-input").value);
  if (!nextRoom) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", nextRoom);
  location.assign(url);
});
function build() {
  if (!online) {
    toast("Reconnect before building.");
    return;
  }
  const mode = buildMode ? null : "place";
  if (mode) openTab("blocks");
  setBuildMode(mode);
}
$("build-button").addEventListener("click", build);
$("build-from-list").addEventListener("click", build);
function selectMaterial(value) {
  material = value;
  for (const button of document.querySelectorAll("[data-material]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.material === value),
    );
  $("cycle-material").textContent = `${MATERIALS[value].name} ▾`;
}
for (const [value, definition] of Object.entries(MATERIALS)) {
  const button = h("button", "material-option");
  button.type = "button";
  button.dataset.material = value;
  button.setAttribute("aria-pressed", String(value === material));
  const swatch = h("span", "material-swatch");
  swatch.style.background = definition.fill;
  button.append(swatch, h("span", "", definition.name));
  button.addEventListener("click", () => {
    selectMaterial(value);
    setBuildMode("place");
  });
  $("material-options").append(button);
}
function setBuildMode(mode) {
  if (mode && !online) {
    toast("Reconnect before building.");
    return;
  }
  cancelBlockMove();
  buildMode = mode;
  if (mode) {
    stopFollowing();
    destination = null;
    keys.clear();
    me.moving = false;
    $("intro-hint").hidden = true;
    if (innerWidth <= 700) {
      $("chat-body").hidden = true;
      $("chat-toggle").textContent = "+";
      $("chat-toggle").setAttribute("aria-label", "Expand field signals");
    }
  }
  world.classList.toggle("building", Boolean(mode));
  $("build-banner").hidden = !mode;
  $("build-button").textContent = mode ? "Finish building" : "+ Build blocks";
  $("place-mode-button").setAttribute("aria-pressed", String(mode === "place"));
  $("move-mode-button").setAttribute("aria-pressed", String(mode === "move"));
  $("move-short").setAttribute("aria-pressed", String(mode === "move"));
  $("erase-mode-button").setAttribute("aria-pressed", String(mode === "erase"));
  $("erase-short").setAttribute("aria-pressed", String(mode === "erase"));
  $("build-status").textContent = mode
    ? "Tap to place. Drag your squares to move them. Their world size stays fixed."
    : "Build at your scale. B starts or finishes.";
  if (mode && innerWidth <= 700)
    document.querySelector(".fieldnotes").classList.remove("expanded");
  world.focus({ preventScroll: true });
}
$("place-mode-button").addEventListener("click", () => setBuildMode("place"));
$("move-mode-button").addEventListener("click", () => setBuildMode("move"));
$("move-short").addEventListener("click", () =>
  setBuildMode(buildMode === "move" ? "place" : "move"),
);
$("erase-mode-button").addEventListener("click", () => setBuildMode("erase"));
$("erase-short").addEventListener("click", () =>
  setBuildMode(buildMode === "erase" ? "place" : "erase"),
);
$("finish-build").addEventListener("click", () => setBuildMode(null));
$("cycle-material").addEventListener("click", () => {
  const values = Object.keys(MATERIALS);
  selectMaterial(values[(values.indexOf(material) + 1) % values.length]);
  setBuildMode("place");
});
function buildPoint() {
  if (buildPointer) {
    const span = spanAt(camera.depth);
    return {
      x:
        camera.x +
        ((buildPointer.x - entities.width / 2) / entities.height) * span,
      y:
        camera.y -
        ((buildPointer.y - entities.height / 2) / entities.height) * span,
    };
  }
  const reach = blockSizeAt(Math.round(me.depth)) * 2.5;
  return {
    x: me.x + Math.sin(me.heading) * reach,
    y: me.y + Math.cos(me.heading) * reach,
  };
}
function buildPreview(point = buildPoint()) {
  if (!buildMode) return null;
  if (selectedBlock) {
    const offset = blockDrag?.offset || { x: 0, y: 0 };
    const cell = cellAt(
      { x: point.x - offset.x, y: point.y - offset.y },
      selectedBlock.depth,
    );
    const problem = movementProblem(
      selectedBlock,
      cell,
      me,
      [me, ...others.values()],
      blocks,
      terrainCollider,
    );
    return {
      cell,
      material: selectedBlock.material,
      allowed: !problem,
      problem,
      moving: true,
      source: selectedBlock,
    };
  }
  const cell =
    buildMode !== "place" ? pickBlock(point, blocks) : cellAt(point, me.depth);
  const problem =
    buildMode !== "place"
      ? !cell
        ? "Choose one of your squares."
        : !cell.owned
          ? "This block belongs to another explorer."
          : !withinBuildReach(cell, me)
            ? "Walk closer. Edit squares at their own scale."
            : null
      : placementProblem(
          cell,
          me,
          [me, ...others.values()],
          blocks,
          terrainCollider,
        );
  return {
    cell,
    material,
    allowed: !problem,
    problem,
    erase: buildMode === "erase",
    picking: buildMode === "move",
  };
}
function cancelBlockMove() {
  const pointerId = blockDrag?.id;
  pointerStart = null;
  blockDrag = null;
  selectedBlock = null;
  world.classList.remove("dragging-block");
  if (pointerId !== undefined && world.hasPointerCapture(pointerId))
    world.releasePointerCapture(pointerId);
}
function selectBlock(block) {
  if (!block?.owned) {
    toast(
      block
        ? "This square belongs to another explorer."
        : "Choose one of your squares.",
    );
    return false;
  }
  if (!withinBuildReach(block, me)) {
    toast("Walk closer. Move squares at their own scale.");
    return false;
  }
  selectedBlock = { ...block };
  $("build-status").textContent =
    "Move the square to a clear cell. Escape cancels.";
  return true;
}
function editAt(point) {
  if (pendingBuild) return;
  if (buildMode === "move" && !selectedBlock) {
    selectBlock(pickBlock(point, blocks));
    return;
  }
  const preview = buildPreview(point);
  if (!preview || preview.problem) {
    if (preview?.problem) toast(preview.problem);
    return;
  }
  commitBuildPreview(preview);
}
function commitBuildPreview(preview) {
  if (pendingBuild || !preview?.cell) return;
  if (preview.problem) {
    toast(preview.problem);
    return;
  }
  if (
    preview.moving &&
    preview.cell.ix === selectedBlock.ix &&
    preview.cell.iy === selectedBlock.iy
  ) {
    cancelBlockMove();
    return;
  }
  const buildId = requestId();
  sendPosition(true);
  const sent = send(
    preview.moving
      ? {
          type: "move-block",
          id: selectedBlock.id,
          ...preview.cell,
          from: {
            ix: selectedBlock.ix,
            iy: selectedBlock.iy,
            depth: selectedBlock.depth,
          },
          requestId: buildId,
        }
      : preview.erase
        ? { type: "remove-block", id: preview.cell.id, requestId: buildId }
        : {
            type: "place-block",
            ...preview.cell,
            material,
            requestId: buildId,
          },
  );
  if (!sent) {
    toast("Reconnect before building.");
    return;
  }
  cancelBlockMove();
  pendingBuild = buildId;
  $("build-status").textContent = "Saving the edit…";
  buildTimer = setTimeout(() => {
    pendingBuild = null;
    toast(
      "The edit has not been confirmed. Check your blocks before trying again.",
      6000,
    );
  }, 10_000);
}
function invite() {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", room);
  url.searchParams.set("x", me.x.toPrecision(16));
  url.searchParams.set("y", me.y.toPrecision(16));
  url.searchParams.set("d", me.depth.toPrecision(16));
  $("share-url").value = url.href;
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);
  $("share-caveat").textContent = local
    ? "This is a local prototype link. It works on this computer; other computers need the server address or a deployed host."
    : "Anyone who can reach this server and has the link can join. Your name and traces are visible to the expedition.";
  openDialog("share-dialog");
}
$("invite-button").addEventListener("click", invite);
$("copy-share").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("share-url").value);
    toast("Expedition link copied.");
    $("share-dialog").close();
  } catch {
    $("share-url").focus();
    $("share-url").select();
    toast("Select and copy this expedition link.");
  }
});

function isEditing() {
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) ||
    Boolean(document.querySelector("dialog[open]"))
  );
}
const movementKeys = [
  "w",
  "a",
  "s",
  "d",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "q",
  "e",
  "Shift",
];
addEventListener("keydown", (event) => {
  if (
    event.defaultPrevented ||
    isEditing() ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey
  )
    return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (movementKeys.includes(key)) {
    event.preventDefault();
    keys.add(key);
    stopFollowing();
    if (!["e", "q", "Shift"].includes(key)) destination = null;
    $("intro-hint").hidden = true;
  }
  if (!event.repeat && key === "b") {
    event.preventDefault();
    build();
  }
  if (buildMode && !event.repeat) {
    if (key === "Escape") {
      event.preventDefault();
      if (selectedBlock) cancelBlockMove();
      else setBuildMode(null);
    }
    if (key === "m") {
      event.preventDefault();
      setBuildMode(buildMode === "move" ? "place" : "move");
    }
    if (key === "r") {
      event.preventDefault();
      setBuildMode(buildMode === "erase" ? "place" : "erase");
    }
    if (["1", "2", "3"].includes(key)) {
      event.preventDefault();
      selectMaterial(Object.keys(MATERIALS)[Number(key) - 1]);
      setBuildMode("place");
    }
    if (key === " ") {
      event.preventDefault();
      editAt(buildPoint());
    }
  }
  if (!event.repeat && key === "h") {
    event.preventDefault();
    go(HOME, "The narrowing passage");
  }
  if (!event.repeat && key === "?") openDialog("help-dialog");
});
addEventListener("keyup", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  keys.delete(key);
});
addEventListener("blur", () => {
  cancelBlockMove();
  keys.clear();
  touchVector = { x: 0, y: 0 };
  me.moving = false;
  sendPosition(true);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    cancelBlockMove();
    keys.clear();
    touchVector = { x: 0, y: 0 };
    me.moving = false;
    sendPosition(true);
  }
  lastFrame = performance.now();
});
function changeDepth(amount) {
  stopFollowing();
  const result = resizeBody(me, me.depth + amount, collider);
  me.depth = result.depth;
  if (result.blocked) {
    contactState = "grow";
    contactUntil = performance.now() + 1000;
  }
  $("intro-hint").hidden = true;
  sendPosition();
}
$("ascend-button").addEventListener("click", () => changeDepth(-0.8));
$("descend-button").addEventListener("click", () => {
  if (me.depth >= MAX_DEPTH)
    toast("You reached the depth limit of this experiment.");
  else changeDepth(0.8);
});
world.addEventListener(
  "wheel",
  (event) => {
    if (event.target.closest("button, input, textarea, select, .conversation"))
      return;
    event.preventDefault();
    changeDepth(clamp(-event.deltaY * 0.0025, -0.55, 0.55));
  },
  { passive: false },
);
world.addEventListener("pointermove", (event) => {
  if (blockDrag && blockDrag.id !== event.pointerId) return;
  if (event.target !== world && event.target.tagName !== "CANVAS") return;
  const rect = world.getBoundingClientRect();
  buildPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
});
world.addEventListener("pointerleave", () => {
  if (!blockDrag) buildPointer = null;
});
world.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !event.isPrimary || blockDrag || isEditing())
    return;
  if (event.target !== world && event.target.tagName !== "CANVAS") return;
  pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  if (!buildMode || buildMode === "erase" || pendingBuild || selectedBlock)
    return;
  const rect = world.getBoundingClientRect();
  buildPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const point = buildPoint(),
    block = pickBlock(point, blocks);
  if (!block) return;
  if (!selectBlock(block)) {
    pointerStart = null;
    return;
  }
  const center = blockPosition(block);
  blockDrag = {
    id: event.pointerId,
    offset: { x: point.x - center.x, y: point.y - center.y },
  };
  world.setPointerCapture(event.pointerId);
  world.classList.add("dragging-block");
  world.focus({ preventScroll: true });
  event.preventDefault();
});
world.addEventListener("pointerup", (event) => {
  if (!pointerStart || pointerStart.id !== event.pointerId) return;
  const start = pointerStart;
  pointerStart = null;
  const rect = world.getBoundingClientRect(),
    x = event.clientX - rect.left,
    y = event.clientY - rect.top;
  buildPointer = { x, y };
  if (blockDrag?.id === event.pointerId) {
    const dragged =
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8;
    const preview = buildPreview();
    blockDrag = null;
    world.classList.remove("dragging-block");
    world.releasePointerCapture(event.pointerId);
    if (dragged) {
      if (x < 0 || y < 0 || x > rect.width || y > rect.height || isEditing())
        cancelBlockMove();
      else if (preview.problem) {
        toast(preview.problem);
        cancelBlockMove();
      } else commitBuildPreview(preview);
    }
    return;
  }
  if (
    Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8 ||
    isEditing()
  )
    return;
  if (buildMode) {
    editAt(buildPoint());
    world.focus({ preventScroll: true });
    return;
  }
  const hit = entities.hit(x, y);
  if (hit?.kind === "passage") {
    stopFollowing();
    destination = { x: hit.value.x, y: hit.value.y };
    $("intro-hint").hidden = true;
    world.focus({ preventScroll: true });
    return;
  }
  if (hit?.kind === "player") {
    openTab("people");
    toast(
      `${hit.value.name} is exploring at depth ${hit.value.depth.toFixed(1)}.`,
    );
    return;
  }
  stopFollowing();
  $("intro-hint").hidden = true;
  world.focus({ preventScroll: true });
  const span = spanAt(camera.depth);
  destination = {
    x: clamp(camera.x + ((x - rect.width / 2) / rect.height) * span, -3, 3),
    y: clamp(camera.y - ((y - rect.height / 2) / rect.height) * span, -2, 2),
  };
});
for (const event of ["pointercancel", "lostpointercapture"])
  world.addEventListener(event, (event) => {
    if (pointerStart?.id === event.pointerId) pointerStart = null;
    if (blockDrag?.id === event.pointerId) cancelBlockMove();
  });
world.addEventListener("dblclick", (event) => {
  if (buildMode) return;
  if (event.target !== world && event.target.tagName !== "CANVAS") return;
  const rect = world.getBoundingClientRect(),
    span = spanAt(camera.depth);
  if (entities.hit(event.clientX - rect.left, event.clientY - rect.top)) return;
  const x = clamp(
    camera.x +
      ((event.clientX - rect.left - rect.width / 2) / rect.height) * span,
    -3,
    3,
  );
  const y = clamp(
    camera.y -
      ((event.clientY - rect.top - rect.height / 2) / rect.height) * span,
    -2,
    2,
  );
  changeDepth(1.4);
  destination = { x, y };
});
const joystick = $("joystick");
let joyCenter;
joystick.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  event.preventDefault();
  const rect = joystick.getBoundingClientRect();
  joyCenter = {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    id: event.pointerId,
  };
  joystick.setPointerCapture(event.pointerId);
  stopFollowing();
  destination = null;
  updateJoystick(event);
});
function updateJoystick(event) {
  if (!joyCenter || event.pointerId !== joyCenter.id) return;
  const x = event.clientX - joyCenter.x,
    y = event.clientY - joyCenter.y,
    length = Math.hypot(x, y),
    scale = length > 28 ? 28 / length : 1;
  touchVector = { x: (x * scale) / 28, y: (-y * scale) / 28 };
  joystick.firstElementChild.style.transform = `translate(${x * scale}px,${y * scale}px)`;
}
joystick.addEventListener("pointermove", updateJoystick);
for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
  joystick.addEventListener(event, () => {
    joyCenter = null;
    touchVector = { x: 0, y: 0 };
    joystick.firstElementChild.style.transform = "";
    $("intro-hint").hidden = true;
  });
$("sound-button").addEventListener("click", async () => {
  try {
    const enabled = await sound.toggle();
    $("sound-button").textContent = enabled ? "Sound on" : "Sound off";
    $("sound-button").setAttribute("aria-pressed", String(enabled));
  } catch {
    toast("Sound is unavailable in this browser.");
  }
});

function updateLabels() {
  $("place-title").textContent = currentPlace;
  $("coordinate-label").textContent =
    `${me.x.toFixed(me.depth > 10 ? 9 : 6)} ${me.y < 0 ? "−" : "+"} ${Math.abs(me.y).toFixed(me.depth > 10 ? 9 : 6)}i`;
  $("depth-label").textContent = me.depth.toFixed(1).padStart(4, "0");
  $("magnification").textContent =
    `${(2 ** me.depth).toLocaleString(undefined, { maximumFractionDigits: me.depth < 4 ? 1 : 0 })}×`;
  $("depth-fill").style.height = `${(me.depth / MAX_DEPTH) * 100}%`;
  $("ascend-button").disabled = me.depth === 0;
  $("descend-button").disabled = me.depth === MAX_DEPTH;
  const blocked = performance.now() < contactUntil ? contactState : "";
  $("body-state").dataset.state = blocked;
  const through =
    Math.hypot(me.x - PASSAGE.x, me.y - PASSAGE.y) <
      bodyRadiusAt(me.depth) * 4 && me.depth > 6;
  $("body-state").textContent =
    blocked === "grow"
      ? "Cannot grow here. Move into open space."
      : blocked === "walk"
        ? "Blocked. Find an opening or go smaller."
        : through
          ? "Inside the narrows. Try growing here."
          : "Solid rock. Your body needs room.";
  $("ascend-button").title = "Grow only when your body has enough room";
  sound.depth(me.depth);
  if (buildMode) {
    const preview = buildPreview();
    $("build-caption").textContent =
      preview.problem ||
      (selectedBlock
        ? "Release or tap to move / Esc cancels"
        : buildMode === "move"
          ? "Drag a square, or tap to pick it up"
          : buildMode === "erase"
            ? "Tap to remove your block"
            : `Tap to place · drag to move / depth ${Math.round(me.depth)}`);
  }
}
let previousMoving = false,
  firstPaint = false;
function frame(now) {
  const rawDt = Math.max(0, (now - lastFrame) / 1000);
  const dt = Math.min(0.25, rawDt);
  lastFrame = now;
  if (!document.hidden) {
    if (terrain.mode === "webgl2" && terrainWasDrawn)
      frameCosts.push(Math.min(rawDt, 0.5));
    terrainWasDrawn = false;
    if (
      terrain.mode === "webgl2" &&
      frameCosts.length >= 6 &&
      now - lastQualityChange > 2500
    ) {
      const average =
        frameCosts.reduce((sum, cost) => sum + cost, 0) / frameCosts.length;
      if (average > 0.045 && terrain.quality > 0.42) {
        terrain.quality = Math.max(0.42, terrain.quality * 0.77);
        resize();
        lastQualityChange = now;
      }
      frameCosts = [];
    }
    const smooth = 1 - Math.exp(-dt * 12);
    for (const player of others.values()) {
      const before = {
        x: player.renderX,
        y: player.renderY,
        depth: player.renderDepth,
        heading: player.renderHeading,
      };
      player.renderX += (player.x - player.renderX) * smooth;
      player.renderY += (player.y - player.renderY) * smooth;
      player.renderDepth += (player.depth - player.renderDepth) * smooth;
      const motion = motionBetween(before, {
        x: player.renderX,
        y: player.renderY,
        depth: player.renderDepth,
      });
      player.renderHeading = motion.heading;
      player.renderMoving =
        player.moving ||
        Math.hypot(player.renderX - before.x, player.renderY - before.y) >
          bodyRadiusAt(player.renderDepth) * 0.02;
    }
    if (followed) {
      const player = others.get(followed);
      if (player) {
        const small = resizeBody(
          me,
          Math.max(me.depth, player.renderDepth),
          collider,
        );
        const moved = moveBody(
          small,
          { x: player.renderX - me.x, y: player.renderY - me.y },
          collider,
        );
        const sized = resizeBody(moved, player.renderDepth, collider);
        Object.assign(me, motionBetween(me, sized), {
          x: sized.x,
          y: sized.y,
          depth: sized.depth,
        });
      } else stopFollowing();
    } else if (!isEditing()) {
      let x =
        Number(keys.has("d") || keys.has("ArrowRight")) -
        Number(keys.has("a") || keys.has("ArrowLeft")) +
        touchVector.x;
      let y =
        Number(keys.has("w") || keys.has("ArrowUp")) -
        Number(keys.has("s") || keys.has("ArrowDown")) +
        touchVector.y;
      if (destination && !x && !y) {
        const dx = destination.x - me.x,
          dy = destination.y - me.y,
          distance = Math.hypot(dx, dy);
        const speed = spanAt(me.depth) * 0.21;
        if (
          distance < Math.max(speed * dt, spanAt(me.depth) / entities.height)
        ) {
          x = dt ? dx / (speed * dt) : 0;
          y = dt ? dy / (speed * dt) : 0;
        } else {
          x = dx / distance;
          y = dy / distance;
        }
      }
      const length = Math.hypot(x, y),
        speed = spanAt(me.depth) * 0.21 * (keys.has("Shift") ? 2.4 : 1);
      me.moving = false;
      if (length > 0.05) {
        const norm = length > 1 ? 1 / length : 1;
        const moved = moveBody(
          me,
          { x: x * norm * speed * dt, y: y * norm * speed * dt },
          collider,
        );
        Object.assign(me, motionBetween(me, moved), { x: moved.x, y: moved.y });
        if (moved.blocked) {
          contactState = "walk";
          contactUntil = now + 600;
        }
        if (
          destination &&
          Math.hypot(destination.x - me.x, destination.y - me.y) <
            bodyRadiusAt(me.depth) * 0.1
        )
          destination = null;
        currentPlace = "Along the Mandelbrot coast";
      }
      if (keys.has("e") || keys.has("q")) {
        const sized = resizeBody(
          me,
          me.depth +
            (Number(keys.has("e")) - Number(keys.has("q"))) * dt * 1.15,
          collider,
        );
        me.depth = sized.depth;
        if (sized.blocked) {
          contactState = "grow";
          contactUntil = now + 600;
        }
      }
    } else me.moving = false;
    camera.x += (me.x - camera.x) * smooth;
    camera.y += (me.y - camera.y) * smooth;
    camera.depth += (me.depth - camera.depth) * smooth;
    if (terrain.mode === "cpu") terrain.reproject(camera);
    const terrainInterval = terrain.mode === "cpu" ? 180 : 33;
    if (!terrain.last || now - lastTerrain > terrainInterval) {
      terrainWasDrawn = terrain.draw(camera);
      lastTerrain = now;
    }
    const renderOthers = [...others.values()].map((player) => ({
      ...player,
      x: player.renderX,
      y: player.renderY,
      depth: player.renderDepth,
      heading: player.renderHeading,
      moving: player.renderMoving,
    }));
    entities.draw({
      camera,
      me,
      others: renderOthers,
      blocks,
      waves,
      bubbles,
      destination,
      time: now,
      reduceMotion,
      physicsState: now < contactUntil ? contactState : "",
      buildPreview: buildPreview(),
    });
    if (!firstPaint && terrain.painted) {
      firstPaint = true;
      $("world-loading").hidden = true;
      world.dataset.ready = "true";
    }
    sendPosition(me.moving !== previousMoving);
    previousMoving = me.moving;
    if (now - lastUi > 200) {
      updateLabels();
      lastUi = now;
    }
  }
  requestAnimationFrame(frame);
}
renderPeople();
renderBlocks();
updateLabels();
connect();
requestAnimationFrame(frame);
setInterval(() => {
  if (online) send({ type: "ping", at: performance.now() });
}, 7000);
addEventListener("pagehide", () => {
  clearTimeout(reconnectTimer);
  socket?.close();
});

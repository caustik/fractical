export const MAX_DEPTH = 18;
export const WORLD_VERSION = "mandelbrot-v1";
export const HOME = Object.freeze({ x: -0.7595, y: 0.105, depth: 4 });
export const PLACES = Object.freeze([
  {
    id: "shore",
    name: "The narrowing passage",
    description:
      "The rock is solid. Walk into the gap, then go smaller to fit.",
    ...HOME,
  },
  {
    id: "seahorse",
    name: "Seahorse valley",
    description: "A coastline that keeps becoming a coastline.",
    x: -0.7435,
    y: 0.1314,
    depth: 8.4,
  },
  {
    id: "elephant",
    name: "Elephant passage",
    description: "Follow the filaments between worlds.",
    x: 0.275,
    y: 0.008,
    depth: 6.7,
  },
  {
    id: "island",
    name: "The western island",
    description: "A little world inside the larger one.",
    x: -1.754,
    y: 0,
    depth: 5.8,
  },
]);
export const COLORS = [
  "#e7b46d",
  "#9bd5c5",
  "#a7bde6",
  "#d6a3b8",
  "#cec588",
  "#c3ace0",
];
export const SIGNALS = Object.freeze({
  hello: "Hello!",
  here: "Over here!",
  follow: "Follow me.",
  wait: "Wait for me.",
  smaller: "Go smaller.",
  thanks: "Thank you!",
});
export const SIGNAL_COOLDOWN_MS = 3000;
export const spanAt = (depth) => 2.8 / 2 ** depth;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const WORLD_BOUNDS = Object.freeze({
  minX: -3,
  maxX: 3,
  minY: -2,
  maxY: 2,
});
export const boundsAround = ({ x, y }, radius = 0) => ({
  minX: x - radius,
  maxX: x + radius,
  minY: y - radius,
  maxY: y + radius,
});
export const insideWorld = (bounds) =>
  bounds.minX >= WORLD_BOUNDS.minX &&
  bounds.maxX <= WORLD_BOUNDS.maxX &&
  bounds.minY >= WORLD_BOUNDS.minY &&
  bounds.maxY <= WORLD_BOUNDS.maxY;
export const clampToWorld = ({ x, y }) => ({
  x: clamp(x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX),
  y: clamp(y, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY),
});
export function validPosition(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.depth) &&
    insideWorld(boundsAround(value)) &&
    value.depth >= 0 &&
    value.depth <= MAX_DEPTH
  );
}
export function readPosition(params) {
  const value = {
    x: Number(params.get("x")),
    y: Number(params.get("y")),
    depth: Number(params.get("d")),
  };
  return params.has("x") &&
    params.has("y") &&
    params.has("d") &&
    validPosition(value)
    ? value
    : { ...HOME };
}
export function roomName(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(value)
    ? value
    : null;
}
export function motionBetween(from, to) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const moving = Math.hypot(dx, dy) > spanAt(to.depth) * 1e-9;
  // World +Y points up; a canvas caret starts at (0, -1).
  return { moving, heading: moving ? Math.atan2(dx, dy) : from.heading || 0 };
}
export function explorerName(seed) {
  if (typeof seed !== "string" || !/^[0-9a-f]{64}$/.test(seed))
    return "Explorer";
  const first = [
    "Amber",
    "Moss",
    "Silver",
    "Coral",
    "Cedar",
    "Golden",
    "Willow",
    "Indigo",
  ];
  const second = [
    "Fox",
    "Finch",
    "Otter",
    "Owl",
    "Hare",
    "Wren",
    "Lynx",
    "Heron",
  ];
  const value = Number.parseInt(seed.slice(0, 8), 16);
  return `${first[value % first.length]} ${second[Math.floor(value / first.length) % second.length]} ${String(Number.parseInt(seed.slice(-6), 16) % 1000).padStart(3, "0")}`;
}

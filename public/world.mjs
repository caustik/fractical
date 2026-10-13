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
    color: "#e7b46d",
  },
  {
    id: "seahorse",
    name: "Seahorse valley",
    description: "A coastline that keeps becoming a coastline.",
    x: -0.7435,
    y: 0.1314,
    depth: 8.4,
    color: "#98d8c3",
  },
  {
    id: "elephant",
    name: "Elephant passage",
    description: "Follow the filaments between worlds.",
    x: 0.275,
    y: 0.008,
    depth: 6.7,
    color: "#92baca",
  },
  {
    id: "island",
    name: "The western island",
    description: "A little world inside the larger one.",
    x: -1.754,
    y: 0,
    depth: 5.8,
    color: "#e7b46d",
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
export function validPosition(value) {
  return (
    value &&
    typeof value === "object" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.depth) &&
    Math.abs(value.x) <= 3 &&
    Math.abs(value.y) <= 2 &&
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
export function escapeIterations(x, y, max = 400) {
  const q = (x - 0.25) ** 2 + y * y;
  if (q * (q + x - 0.25) <= 0.25 * y * y || (x + 1) ** 2 + y * y <= 0.0625)
    return max;
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

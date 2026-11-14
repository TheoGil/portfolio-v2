import "./style.css";
import { Bodies, Body, Runner, Spring, World } from "./physics/index.ts";

// -----------------------------------------------------------------------------
// Canvas
// -----------------------------------------------------------------------------

const canvasEl = document.querySelector<HTMLCanvasElement>(".js-canvas")!;
const ctx = canvasEl.getContext("2d")!;
let width = 0;
let height = 0;

function updateCanvasSize() {
  const dpr = Math.min(devicePixelRatio, 2);
  width = innerWidth;
  height = innerHeight;
  canvasEl.width = Math.round(width * dpr);
  canvasEl.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const colors = {
  text: "",
  bg: "",
  static: "",
  rigid: "",
  pressure: "",
  shape: "",
  debug: "",
};
function updateColors() {
  const style = getComputedStyle(document.documentElement);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  colors.text = style.getPropertyValue("--text").trim() || "#6b6375";
  colors.bg = style.getPropertyValue("--bg").trim() || "#fff";
  colors.static = style.getPropertyValue("--border").trim() || "#e5e4e7";
  colors.rigid = style.getPropertyValue("--text-h").trim() || "#08060d";
  colors.pressure = style.getPropertyValue("--accent").trim() || "#aa3bff";
  colors.shape = dark ? "#2dd4bf" : "#0d9488";
  colors.debug = dark ? "#f87171" : "#dc2626";
}

// -----------------------------------------------------------------------------
// World
// -----------------------------------------------------------------------------

const world = new World({ gravity: { x: 0, y: 1000 } });
const WALL = 400;
const walls = {
  ground: Bodies.rectangle(0, 0, 20000, WALL, {
    isStatic: true,
    label: "wall",
  }),
  ceiling: Bodies.rectangle(0, 0, 20000, WALL, {
    isStatic: true,
    label: "wall",
  }),
  left: Bodies.rectangle(0, 0, WALL, 20000, { isStatic: true, label: "wall" }),
  right: Bodies.rectangle(0, 0, WALL, 20000, { isStatic: true, label: "wall" }),
};

function placeWalls(teleport: boolean) {
  walls.ground.setPosition(width / 2, height + WALL / 2, teleport);
  walls.ceiling.setPosition(width / 2, -WALL / 2, teleport);
  walls.left.setPosition(-WALL / 2, height / 2, teleport);
  walls.right.setPosition(width + WALL / 2, height / 2, teleport);
}

let time = 0;

function populate() {
  world.clear();
  world.add(...Object.values(walls));
  placeWalls(true);
  time = 0;

  faces.clear();

  // `count` random blobs. One overlapping a previous blob is discarded, so
  // there can be fewer than `count`.
  const placed: { x: number; y: number; r: number }[] = [];
  for (let n = 0; n < blobSettings.count; n++) {
    const r = randomRadius();
    const x = randomBetween(r, width - r);
    const y = randomBetween(r, height - r);
    const overlaps = placed.some(
      (b) => (b.x - x) ** 2 + (b.y - y) ** 2 < (b.r + r) ** 2,
    );
    if (overlaps) continue;
    placed.push({ x, y, r });
    addBlob(x, y, r);
  }
}

/**
 * Blobs, tuned with the DialKit "Blobs" panel (see loadDials).
 * `count`: blobs created by populate. `radius` is relative to the smallest
 * side of the screen.
 */
const blobSettings = {
  count: 100,
  radius: { min: 0.04, max: 0.18 },
  pressure: { min: 300, max: 1500 },
};

const randomBetween = (a: number, b: number) => a + Math.random() * (b - a);

function randomRadius() {
  const { min, max } = blobSettings.radius;
  return randomBetween(min, max) * Math.min(width, height);
}

function addBlob(x: number, y: number, r: number) {
  const { pressure } = blobSettings;
  const body = Bodies.circle(x, y, r, {
    kind: "pressure",
    pressure: randomBetween(pressure.min, pressure.max),
    angle: Math.random() * Math.PI * 2,
  });
  world.add(body);
  addFace(body, r);
}

function spawn(x: number, y: number) {
  addBlob(x, y, randomRadius());
}

function setAllPressures(pressure: number) {
  for (const body of faces.keys()) {
    if (body.kind === "pressure") body.setPressure(pressure);
  }
}

// -----------------------------------------------------------------------------
// Faces: pure rendering, drawn in the rest frame of the body (see drawFace)
// -----------------------------------------------------------------------------

interface Palette {
  body: string;
  mouth: string;
  eye: string;
  pupil: string;
}

const PALETTES: Palette[] = [
  { body: "#00C84A", mouth: "#1E1E1E", eye: "#FCF7F3", pupil: "#1E1E1E" },
  { body: "#CE4BFF", mouth: "#1E1E1E", eye: "#FCF7F3", pupil: "#1E1E1E" },
  { body: "#FBD710", mouth: "#1E1E1E", eye: "#FCF7F3", pupil: "#1E1E1E" },
  { body: "#FE7D00", mouth: "#1E1E1E", eye: "#FCF7F3", pupil: "#1E1E1E" },
  { body: "#FF3201", mouth: "#1E1E1E", eye: "#FCF7F3", pupil: "#1E1E1E" },
];

/**
 * Face proportions, relative to the blob radius (y down, 0 at the centroid).
 * Tuned live with the DialKit panel (see loadDials).
 */
const faceStyle = {
  eyes: { size: 0.1, pupil: 0.62, spacing: 0.56, y: -0.41 },
  /** `height`: depth of the curve, negative frowns. */
  mouth: { y: -0.23, width: 0.22, height: 0.09, strokeWidth: 0.04 },
};

interface Face {
  /** Radius of the body, faces are drawn relative to it. */
  size: number;
  palette: Palette;
  /** Smoothed sideways speed in the body frame, -1..1: the face slides toward it. */
  look: number;
  blinkAt: number;
}

const faces = new Map<Body, Face>();

function addFace(body: Body, size: number) {
  faces.set(body, {
    size,
    palette: PALETTES[Math.floor(Math.random() * PALETTES.length)],
    look: 0,
    blinkAt: time + 1 + Math.random() * 4,
  });
}

async function loadDials() {
  const [{ createDialKit, createDialRoot }] = await Promise.all([
    import("dialkit/vanilla"),
    import("dialkit/vanilla/styles.css"),
  ]);
  createDialRoot({
    position: "top-right",
    defaultOpen: false,
    // The default "thumbnails" captures the whole page (canvas included) on
    // load and after each change, which freezes the page for ~1s.
    versions: "menu",
  });
  const { eyes, mouth } = faceStyle;
  createDialKit("Faces", {
    eyes: {
      size: [eyes.size, 0.02, 0.5, 0.01],
      pupil: [eyes.pupil, 0, 1, 0.01],
      spacing: [eyes.spacing, 0, 1.5, 0.01],
      y: [eyes.y, -1, 1, 0.01],
    },
    mouth: {
      y: [mouth.y, -1, 1, 0.01],
      width: [mouth.width, 0, 1.5, 0.01],
      height: [mouth.height, -0.5, 0.5, 0.01],
      strokeWidth: [mouth.strokeWidth, 0.01, 0.3, 0.01],
    },
  }).subscribe((values) => {
    Object.assign(faceStyle.eyes, values.eyes);
    Object.assign(faceStyle.mouth, values.mouth);
  });

  const { radius, pressure } = blobSettings;
  // `setAll` applies to every blob, only when it is moved (subscribe also
  // runs on load and when any other control changes)
  let setAll = 600;
  createDialKit(
    "Blobs",
    {
      count: [blobSettings.count, 0, 60, 1],
      respawn: { type: "action" },
      radius: {
        min: [radius.min, 0.01, 0.3, 0.005],
        max: [radius.max, 0.01, 0.3, 0.005],
      },
      pressure: {
        min: [pressure.min, 50, 3000, 10],
        max: [pressure.max, 50, 3000, 10],
        setAll: [setAll, 50, 3000, 10],
      },
    },
    {
      onAction(action) {
        if (action !== "respawn") return;
        releaseAll();
        populate();
      },
    },
  ).subscribe((values) => {
    blobSettings.count = values.count;
    Object.assign(blobSettings.radius, values.radius);
    blobSettings.pressure.min = values.pressure.min;
    blobSettings.pressure.max = values.pressure.max;
    if (values.pressure.setAll !== setAll) {
      setAll = values.pressure.setAll;
      setAllPressures(setAll);
    }
  });
}

// -----------------------------------------------------------------------------
// Pointer
// -----------------------------------------------------------------------------

/** One drag per pointer: several fingers can drag at once. */
const drags = new Map<number, Spring>();

/** Fingers are imprecise: grab the closest body within this distance (px). */
const TOUCH_TOLERANCE = 24;

/** Dynamic body under (x, y), or the closest one within `tolerance`. */
function pickBody(x: number, y: number, tolerance: number) {
  const hit = world.bodiesAt(x, y).find((b) => !b.isStatic);
  if (hit || tolerance <= 0) return hit;
  let best: Body | undefined;
  let bestDist = tolerance * tolerance;
  for (const body of world.bodies) {
    if (body.isStatic) continue;
    if (x < body.minX - tolerance || x > body.maxX + tolerance) continue;
    if (y < body.minY - tolerance || y > body.maxY + tolerance) continue;
    const i = body.closestPoint(x, y);
    const d = (body.px[i] - x) ** 2 + (body.py[i] - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = body;
    }
  }
  return best;
}

canvasEl.addEventListener("pointerdown", (event) => {
  const { clientX: x, clientY: y, pointerId } = event;
  release(pointerId);
  const body = pickBody(
    x,
    y,
    event.pointerType === "mouse" ? 0 : TOUCH_TOLERANCE,
  );
  if (!body) {
    spawn(x, y);
    return;
  }
  canvasEl.setPointerCapture(pointerId);
  const drag = new Spring({
    bodyA: body,
    pointA: body.closestPoint(x, y),
    x,
    y,
    length: 0,
    stiffness: 400,
    damping: 25,
  });
  drags.set(pointerId, drag);
  world.add(drag);
});

canvasEl.addEventListener("pointermove", (event) => {
  drags.get(event.pointerId)?.setAnchor(event.clientX, event.clientY);
});

function release(pointerId: number) {
  const drag = drags.get(pointerId);
  if (!drag) return;
  world.remove(drag);
  drags.delete(pointerId);
}

function releaseAll() {
  for (const drag of drags.values()) world.remove(drag);
  drags.clear();
}

for (const type of [
  "pointerup",
  "pointercancel",
  "lostpointercapture",
] as const) {
  canvasEl.addEventListener(type, (event) => release(event.pointerId));
}
// Long press opens a context menu on touch devices, which cancels the pointer
canvasEl.addEventListener("contextmenu", (event) => event.preventDefault());

// -----------------------------------------------------------------------------
// Keyboard
// -----------------------------------------------------------------------------

let debug = false;

addEventListener("keydown", (event) => {
  // Ignore keys typed in the DialKit panel
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable]")) return;
  if (event.key === "d" || event.key === "D") debug = !debug;
  if (event.key === "r" || event.key === "R") {
    releaseAll();
    populate();
  }
  if (event.key === " ") {
    event.preventDefault();
    if (runner.isRunning) runner.stop();
    else runner.start();
  }
});

// -----------------------------------------------------------------------------
// Rendering (not part of the engine)
// -----------------------------------------------------------------------------

function bodyColor(body: Body) {
  if (body.isStatic) return colors.static;
  if (body.kind === "pressure") return colors.pressure;
  if (body.kind === "shape") return colors.shape;
  return colors.rigid;
}

/** Soft bodies: smooth curve through the edge midpoints. Others: polygon. */
function tracePath(body: Body) {
  const { rx, ry, next, loopStarts } = body;
  const smooth = body.isSoft;
  for (let k = 0; k < loopStarts.length - 1; k++) {
    const start = loopStarts[k];
    const end = loopStarts[k + 1];
    if (smooth) {
      const last = end - 1;
      ctx.moveTo((rx[last] + rx[start]) / 2, (ry[last] + ry[start]) / 2);
      for (let i = start; i < end; i++) {
        const j = next[i];
        ctx.quadraticCurveTo(
          rx[i],
          ry[i],
          (rx[i] + rx[j]) / 2,
          (ry[i] + ry[j]) / 2,
        );
      }
    } else {
      ctx.moveTo(rx[start], ry[start]);
      for (let i = start + 1; i < end; i++) ctx.lineTo(rx[i], ry[i]);
    }
    ctx.closePath();
  }
}

function drawBody(body: Body) {
  const color = bodyColor(body);
  ctx.beginPath();
  tracePath(body);
  if (debug) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  const face = faces.get(body);
  if (face) {
    ctx.fillStyle = face.palette.body;
    ctx.fill("evenodd");
    return;
  }
  ctx.globalAlpha = body.isStatic ? 1 : 0.18;
  ctx.fillStyle = color;
  ctx.fill("evenodd");
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
}

const faceTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function drawFace(body: Body, face: Face, frameDelta: number) {
  const r = face.size;

  // The face slides toward the side the body is moving to
  const sideSpeed = body.cos * body.velocityX + body.sin * body.velocityY;
  const target = Math.max(-1, Math.min(1, sideSpeed / 300));
  face.look += (target - face.look) * Math.min(1, frameDelta * 5);

  if (time > face.blinkAt + 0.12) face.blinkAt = time + 2 + Math.random() * 4;
  const open = time > face.blinkAt ? 0.15 : 1;

  // From here, draw in the rest frame of the body: origin at its centroid, y
  // down, unrotated. The transform follows rotation and part of the squash.
  const t = body.getTransform(0.7, faceTransform);
  ctx.save();
  ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
  ctx.translate(face.look * r * 0.35, 0);

  const { eyes, mouth } = faceStyle;
  const { palette } = face;

  // Round eyes with a centered pupil, squashed vertically to blink
  const eyeX = (r * eyes.spacing) / 2;
  const eyeY = r * eyes.y;
  const eyeR = r * eyes.size;
  const pupilR = eyeR * eyes.pupil;
  for (const [radius, color] of [
    [eyeR, palette.eye],
    [pupilR, palette.pupil],
  ] as const) {
    if (radius <= 0) continue;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(side * eyeX + radius, eyeY);
      ctx.ellipse(side * eyeX, eyeY, radius, radius * open, 0, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Mouth: circular arc with its corners at `mouth.y`, `mouth.width` apart,
  // bulging down by `mouth.height` (up if negative, straight if 0)
  if (mouth.width > 0) {
    const halfWidth = (r * mouth.width) / 2;
    const depth = r * mouth.height;
    const y = r * mouth.y;
    ctx.beginPath();
    if (Math.abs(depth) < 0.01) {
      ctx.moveTo(-halfWidth, y);
      ctx.lineTo(halfWidth, y);
    } else {
      const radius =
        (depth * depth + halfWidth * halfWidth) / (2 * Math.abs(depth));
      const cy = y + depth - Math.sign(depth) * radius;
      const corner = Math.atan2(y - cy, halfWidth);
      ctx.arc(0, cy, radius, corner, Math.PI - corner, depth < 0);
    }
    ctx.strokeStyle = palette.mouth;
    ctx.lineWidth = r * mouth.strokeWidth;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

function drawDebug(body: Body) {
  const { rx, ry } = body;
  const color = bodyColor(body);

  // Internal springs
  if (body.springA.length > body.pointCount) {
    ctx.beginPath();
    for (let s = body.pointCount; s < body.springA.length; s++) {
      ctx.moveTo(rx[body.springA[s]], ry[body.springA[s]]);
      ctx.lineTo(rx[body.springB[s]], ry[body.springB[s]]);
    }
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Shape matching targets
  if (body.isSoft && body.shapeStiffness !== 0) {
    ctx.beginPath();
    for (let i = 0; i < body.pointCount; i++) {
      const tx = body.x + body.cos * body.lx[i] - body.sin * body.ly[i];
      const ty = body.y + body.sin * body.lx[i] + body.cos * body.ly[i];
      ctx.moveTo(rx[i], ry[i]);
      ctx.lineTo(tx, ty);
      ctx.moveTo(tx + 1.5, ty);
      ctx.arc(tx, ty, 1.5, 0, Math.PI * 2);
    }
    ctx.strokeStyle = colors.text;
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Points
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < body.pointCount; i++) {
    ctx.moveTo(rx[i] + 2, ry[i]);
    ctx.arc(rx[i], ry[i], 2, 0, Math.PI * 2);
  }
  ctx.fill();

  // Frame
  if (!body.isStatic) {
    ctx.beginPath();
    ctx.moveTo(body.x, body.y);
    ctx.lineTo(body.x + body.cos * 15, body.y + body.sin * 15);
    ctx.strokeStyle = colors.debug;
    ctx.stroke();
  }
}

function drawContacts() {
  const { items, count } = world.contacts;
  ctx.beginPath();
  for (let c = 0; c < count; c++) {
    const { bodyA, point, nx, ny } = items[c];
    const x = bodyA.px[point];
    const y = bodyA.py[point];
    ctx.moveTo(x, y);
    ctx.lineTo(x + nx * 10, y + ny * 10);
  }
  ctx.strokeStyle = colors.debug;
  ctx.stroke();
}

function drawDrag() {
  if (drags.size === 0) return;
  ctx.beginPath();
  for (const { bodyA, pointA, anchorX, anchorY } of drags.values()) {
    ctx.moveTo(bodyA.rx[pointA], bodyA.ry[pointA]);
    ctx.lineTo(anchorX, anchorY);
  }
  ctx.strokeStyle = colors.text;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
}

// Stats
let physicsTime = 0;
let frameTime = 1 / 60;
const statsText = { value: "" };
let statsAge = 0;

function drawStats(frameDelta: number) {
  frameTime += (frameDelta - frameTime) * 0.05;
  statsAge += frameDelta;
  if (statsAge > 0.25) {
    statsAge = 0;
    const points = world.bodies.reduce((sum, b) => sum + b.pointCount, 0);
    statsText.value = `${Math.round(1 / frameTime)} fps · physics ${physicsTime.toFixed(2)} ms/frame · ${world.bodies.length} bodies · ${points} points · ${world.contacts.count} contacts`;
  }
  // Text only in wireframe mode (D)
  if (!debug) return;
  ctx.font = "12px ui-monospace, Consolas, monospace";
  ctx.fillStyle = colors.text;
  ctx.fillText(
    "drag bodies · click to spawn · D wireframe · R reset · space pause",
    16,
    24,
  );
  ctx.fillText(statsText.value, 16, 42);
}

function render(frameDelta: number) {
  ctx.clearRect(0, 0, width, height);
  for (const body of world.bodies) {
    if (body.label !== "wall") drawBody(body);
  }
  if (!debug) {
    for (const [body, face] of faces) drawFace(body, face, frameDelta);
  }
  if (debug) {
    for (const body of world.bodies) {
      if (body.label !== "wall") drawDebug(body);
    }
    drawContacts();
  }
  drawDrag();
  drawStats(frameDelta);
}

// -----------------------------------------------------------------------------
// Loop
// -----------------------------------------------------------------------------

let framePhysics = 0;
const runner = new Runner(world, {
  fixedDelta: 1 / 120,
  onStep(dt) {
    time += dt;
  },
  onRender(_alpha, frameDelta) {
    physicsTime += (framePhysics - physicsTime) * 0.05;
    framePhysics = 0;
    render(frameDelta);
  },
});

const step = world.step.bind(world);
world.step = (dt: number) => {
  const t0 = performance.now();
  step(dt);
  framePhysics += performance.now() - t0;
};

updateCanvasSize();
updateColors();
populate();
runner.start();
// Loaded after the scene: faces use the default `faceStyle` until then
loadDials();

addEventListener("resize", () => {
  updateCanvasSize();
  placeWalls(false);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener(
  "change",
  updateColors,
);

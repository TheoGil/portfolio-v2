import "./style.css";
import { Bodies, Body, Runner, Shapes, Spring, World } from "./physics/index.ts";

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

const colors = { text: "", bg: "", static: "", rigid: "", pressure: "", shape: "", debug: "" };
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
  ground: Bodies.rectangle(0, 0, 20000, WALL, { isStatic: true, label: "wall" }),
  ceiling: Bodies.rectangle(0, 0, 20000, WALL, { isStatic: true, label: "wall" }),
  left: Bodies.rectangle(0, 0, WALL, 20000, { isStatic: true, label: "wall" }),
  right: Bodies.rectangle(0, 0, WALL, 20000, { isStatic: true, label: "wall" }),
};

function placeWalls(teleport: boolean) {
  walls.ground.setPosition(width / 2, height + WALL / 2, teleport);
  walls.ceiling.setPosition(width / 2, -WALL / 2, teleport);
  walls.left.setPosition(-WALL / 2, height / 2, teleport);
  walls.right.setPosition(width + WALL / 2, height / 2, teleport);
}

let platform: Body;
let paddle: Body;
let time = 0;

function populate() {
  world.clear();
  world.add(...Object.values(walls));
  placeWalls(true);
  time = 0;

  const s = Math.min(1, Math.max(0.6, width / 1400));
  const col = (k: number) => width * (0.1 + 0.8 * k);

  // Moving static platform & kinematic jelly paddle
  // Thin static bodies get subdivided: more points means fewer bodies
  // straddling them undetected.
  platform = Bodies.rectangle(col(0.25), height * 0.62, 200 * s, 30, {
    isStatic: true,
    segmentLength: 20,
    label: "platform",
  });
  paddle = Bodies.rectangle(col(0.72), height * 0.6, 220 * s, 26 * s, {
    kind: "shape",
    kinematic: true,
    shapeStiffness: 1500,
    label: "paddle",
  });
  world.add(platform, paddle);

  // Pressure blobs (gas)
  world.add(
    Bodies.circle(col(0.05), height * 0.2, 70 * s, { kind: "pressure" }),
    Bodies.circle(col(0.2), height * 0.1, 45 * s, { kind: "pressure", pressure: 300 }),
    Bodies.circle(col(0.55), height * 0.15, 55 * s, { kind: "pressure", pressure: 1500 }),
    Bodies.ring(col(0.9), height * 0.2, 60 * s, 38 * s, { kind: "pressure", label: "tire" }),
  );

  // Shape matching
  world.add(
    Bodies.star(col(0.35), height * 0.1, 5, 60 * s, 30 * s, { kind: "shape" }),
    Bodies.ring(col(0.45), height * 0.3, 55 * s, 28 * s, { kind: "shape", label: "O" }),
    Bodies.rectangle(col(0.65), height * 0.1, 140 * s, 60 * s, { kind: "shape" }),
    Bodies.fromVertices(col(0.8), height * 0.1, blobVertices(60 * s), { kind: "shape" }),
  );

  // Rigid bodies
  world.add(
    Bodies.rectangle(col(0.25), height * 0.4, 60 * s, 60 * s),
    Bodies.rectangle(col(0.27), height * 0.3, 90 * s, 40 * s, { angle: 0.3 }),
    Bodies.polygon(col(0.6), height * 0.35, 3, 45 * s),
    Bodies.circle(col(0.7), height * 0.3, 30 * s, { restitution: 0.6 }),
    Bodies.compound(
      col(0.95),
      height * 0.4,
      [Shapes.rectangle(26 * s, 80 * s), Shapes.translate(Shapes.circle(16 * s, 16), 0, -70 * s)],
      { label: "i" },
    ),
  );
}

/** Irregular rounded blob. */
function blobVertices(radius: number) {
  const points = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = radius * (1 + 0.25 * Math.sin(a * 3) + 0.1 * Math.cos(a * 5));
    points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8 });
  }
  return points;
}

function spawn(x: number, y: number) {
  const r = 25 + Math.random() * 30;
  const pick = Math.floor(Math.random() * 4);
  const body =
    pick === 0
      ? Bodies.circle(x, y, r, { kind: "pressure", pressure: 300 + Math.random() * 1200 })
      : pick === 1
        ? Bodies.star(x, y, 4 + Math.floor(Math.random() * 3), r * 1.3, r * 0.7, { kind: "shape" })
        : pick === 2
          ? Bodies.ring(x, y, r * 1.2, r * 0.6, { kind: "shape" })
          : Bodies.rectangle(x, y, r * 1.6, r * 1.2, { angle: Math.random() * Math.PI });
  world.add(body);
}

// -----------------------------------------------------------------------------
// Pointer
// -----------------------------------------------------------------------------

let drag: Spring | null = null;

canvasEl.addEventListener("pointerdown", (event) => {
  const body = world.bodiesAt(event.clientX, event.clientY).find((b) => !b.isStatic);
  if (!body) {
    spawn(event.clientX, event.clientY);
    return;
  }
  canvasEl.setPointerCapture(event.pointerId);
  drag = new Spring({
    bodyA: body,
    pointA: body.closestPoint(event.clientX, event.clientY),
    x: event.clientX,
    y: event.clientY,
    length: 0,
    stiffness: 400,
    damping: 25,
  });
  world.add(drag);
});

canvasEl.addEventListener("pointermove", (event) => {
  drag?.setAnchor(event.clientX, event.clientY);
});

function release() {
  if (drag) world.remove(drag);
  drag = null;
}
canvasEl.addEventListener("pointerup", release);
canvasEl.addEventListener("pointercancel", release);

// -----------------------------------------------------------------------------
// Keyboard
// -----------------------------------------------------------------------------

let debug = false;

addEventListener("keydown", (event) => {
  if (event.key === "d" || event.key === "D") debug = !debug;
  if (event.key === "r" || event.key === "R") {
    release();
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
        ctx.quadraticCurveTo(rx[i], ry[i], (rx[i] + rx[j]) / 2, (ry[i] + ry[j]) / 2);
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
  ctx.globalAlpha = body.isStatic ? 1 : 0.18;
  ctx.fillStyle = color;
  ctx.fill("evenodd");
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();
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
  if (!drag) return;
  const { bodyA, pointA } = drag;
  ctx.beginPath();
  ctx.moveTo(bodyA.rx[pointA], bodyA.ry[pointA]);
  ctx.lineTo(drag.anchorX, drag.anchorY);
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
  ctx.font = "12px ui-monospace, Consolas, monospace";
  ctx.fillStyle = colors.text;
  ctx.fillText("drag bodies · click to spawn · D wireframe · R reset · space pause", 16, 24);
  ctx.fillText(statsText.value, 16, 42);
}

function render(frameDelta: number) {
  ctx.clearRect(0, 0, width, height);
  for (const body of world.bodies) {
    if (body.label !== "wall") drawBody(body);
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
    platform.setPosition(width * 0.3 + Math.sin(time * 0.8) * width * 0.08, platform.y);
    paddle.setAngle(time * 0.9);
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

addEventListener("resize", () => {
  updateCanvasSize();
  placeWalls(false);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateColors);

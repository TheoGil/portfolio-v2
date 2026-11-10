import { normalizeShape, Shapes, signedArea, type Shape } from "./shapes.ts";

/**
 * - `rigid`: classic rigid body. Points follow the body frame exactly.
 * - `pressure`: soft body kept in shape by edge springs + internal gas pressure.
 * - `shape`: soft body kept in shape by springs pulling every point towards
 *   a rigid copy of its rest shape (shape matching).
 *
 * Both soft kinds support springs, pressure and shape matching at the same
 * time: the kind only selects sensible defaults.
 */
export type BodyKind = "rigid" | "pressure" | "shape";

export interface CollisionFilter {
  /** Bit field of the categories this body belongs to. */
  category: number;
  /** Bit field of the categories this body collides with. */
  mask: number;
  /** Same non-zero group: positive always collide, negative never collide. */
  group: number;
}

export interface BodyOptions {
  /** Position of the body centroid. */
  x?: number;
  y?: number;
  angle?: number;
  kind?: BodyKind;
  /** Static bodies are not affected by the simulation but can be moved with setPosition/setAngle. */
  isStatic?: boolean;
  /**
   * Soft bodies only: the shape matching frame is driven by setPosition/setAngle
   * instead of following the points. Makes squishy moving platforms.
   */
  kinematic?: boolean;
  /** Total mass. Defaults to `area * density`. */
  mass?: number;
  density?: number;
  friction?: number;
  restitution?: number;
  /** Velocity damping, in 1/s. */
  airFriction?: number;
  gravityScale?: number;
  /** Soft bodies only: edges longer than this are subdivided. 0 disables. */
  segmentLength?: number;

  // Soft body tuning. Stiffness values are normalized by point mass (they are
  // accelerations), so they behave the same whatever the size or mass of the body.
  edgeStiffness?: number;
  edgeDamping?: number;
  /** Springs between points i and i+2, resisting bending. */
  bendStiffness?: number;
  bendDamping?: number;
  shapeStiffness?: number;
  shapeDamping?: number;
  /** Gas pressure. Higher is firmer. */
  pressure?: number;
  /** Amount of gas relative to the rest area. > 1 inflates the body, < 1 deflates it. */
  inflation?: number;

  collisionFilter?: Partial<CollisionFilter>;
  label?: string;
  data?: unknown;
}

interface SoftTuning {
  edgeStiffness: number;
  edgeDamping: number;
  bendStiffness: number;
  bendDamping: number;
  shapeStiffness: number;
  shapeDamping: number;
  pressure: number;
}

export const SOFT_DEFAULTS: Record<"pressure" | "shape", SoftTuning> = {
  pressure: {
    edgeStiffness: 2500,
    edgeDamping: 12,
    bendStiffness: 0,
    bendDamping: 0,
    shapeStiffness: 0,
    // Damps deformation without stiffness, otherwise transverse modes of
    // the outline are never damped.
    shapeDamping: 8,
    pressure: 600,
  },
  shape: {
    edgeStiffness: 1500,
    edgeDamping: 12,
    bendStiffness: 0,
    bendDamping: 0,
    shapeStiffness: 600,
    shapeDamping: 12,
    pressure: 0,
  },
};

const TAU = Math.PI * 2;
/** Max pre-stretch of pressure body edges, relative to their length. */
const MAX_PRESTRETCH = 0.6;
/** Auto-stiffening cap, stable with the default 1/240s sub-step. */
const MAX_EDGE_STIFFNESS = 30000;
/** Default shape matching of pressure bodies with holes. */
const HOLE_SHAPE_STIFFNESS = 400;
let nextId = 1;

export class Body {
  readonly id = nextId++;
  label: string;
  data: unknown;

  readonly kind: BodyKind;
  readonly isStatic: boolean;
  /** Dynamic rigid body. */
  readonly isRigid: boolean;
  /** Dynamic soft body (pressure or shape). */
  readonly isSoft: boolean;
  readonly kinematic: boolean;

  // --- Topology. Edge i goes from point i to point next[i]. ---
  readonly pointCount: number;
  /** Loop k spans points [loopStarts[k], loopStarts[k + 1]). */
  readonly loopStarts: number[];
  readonly next: Int32Array;
  readonly prev: Int32Array;

  // --- Point state ---
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  /** Inverse mass per point. Set one to 0 to pin the point (soft bodies). */
  readonly pointInvMass: Float64Array;
  /** Positions at the start of the last step, used for interpolation. */
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  /** Interpolated positions, for rendering. Updated by `World.interpolate`. */
  readonly rx: Float64Array;
  readonly ry: Float64Array;
  /** Rest shape, relative to the centroid, at angle 0. */
  readonly lx: Float64Array;
  readonly ly: Float64Array;
  /** @internal Impulses of the last contact of each point, for warm starting. */
  readonly warmJn: Float64Array;
  readonly warmJt: Float64Array;
  readonly warmEdge: Int32Array;
  readonly warmBody: Int32Array;
  readonly warmStamp: Int32Array;

  // --- Frame. State of rigid/static bodies, derived from points for soft ones. ---
  x = 0;
  y = 0;
  angle = 0;
  velocityX = 0;
  velocityY = 0;
  angularVelocity = 0;
  cos = 1;
  sin = 0;

  // --- Mass ---
  readonly mass: number;
  readonly inverseMass: number;
  readonly inertia: number;
  readonly inverseInertia: number;
  readonly pointMass: number;
  /** Signed area of the material (holes subtracted), at rest. */
  readonly restArea: number;

  friction: number;
  restitution: number;
  airFriction: number;
  gravityScale: number;
  readonly collisionFilter: CollisionFilter;

  // --- Soft tuning (absolute values, already multiplied by point mass) ---
  readonly springA: number[] = [];
  readonly springB: number[] = [];
  readonly springRest: number[] = [];
  readonly springK: number[] = [];
  readonly springD: number[] = [];
  shapeStiffness: number;
  shapeDamping: number;
  /** Gas pressure, already multiplied by point mass. */
  pressure: number;
  /**
   * Gas amount relative to the rest area. Pressure follows the ideal gas law:
   * P = pressure * inflation * restArea / area
   * Edges are pre-tensioned to balance it at rest, so the body keeps its
   * authored size unless inflated (> 1) or deflated (< 1).
   */
  inflation: number;
  /** Outer loops, filled with gas, as [start, end) pairs. */
  private readonly gasLoops: number[] = [];
  /** Area enclosed by the outer loops, at rest. */
  private readonly gasRestArea: number;

  // --- Bounds ---
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;

  // --- External forces, cleared after each step ---
  forceX = 0;
  forceY = 0;
  torque = 0;

  // --- Driven motion (static & kinematic) ---
  private toX = 0;
  private toY = 0;
  private toAngle = 0;
  private fromX = 0;
  private fromY = 0;
  private fromAngle = 0;
  private pendingDrive = false;
  private driving = false;

  constructor(shape: Shape, options: BodyOptions = {}) {
    this.kind = options.kind ?? "rigid";
    this.isStatic = options.isStatic ?? false;
    this.isRigid = !this.isStatic && this.kind === "rigid";
    this.isSoft = !this.isStatic && this.kind !== "rigid";
    this.kinematic = this.isSoft && (options.kinematic ?? false);
    this.label = options.label ?? (this.isStatic ? "static" : this.kind);
    this.data = options.data;

    let loops = normalizeShape(shape);
    const segmentLength = options.segmentLength ?? (this.isSoft ? 16 : 0);
    if (segmentLength > 0) loops = Shapes.subdivide(loops, segmentLength);
    if (loops.length === 0) throw new Error("Body: shape has no valid loop");

    // Flatten loops
    const n = loops.reduce((sum, loop) => sum + loop.length, 0);
    this.pointCount = n;
    this.loopStarts = [];
    this.next = new Int32Array(n);
    this.prev = new Int32Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.fx = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.pointInvMass = new Float64Array(n);
    this.prevX = new Float64Array(n);
    this.prevY = new Float64Array(n);
    this.rx = new Float64Array(n);
    this.ry = new Float64Array(n);
    this.lx = new Float64Array(n);
    this.ly = new Float64Array(n);
    this.warmJn = new Float64Array(n);
    this.warmJt = new Float64Array(n);
    this.warmEdge = new Int32Array(n);
    this.warmBody = new Int32Array(n);
    this.warmStamp = new Int32Array(n);

    let index = 0;
    for (const loop of loops) {
      const start = index;
      this.loopStarts.push(start);
      for (let k = 0; k < loop.length; k++, index++) {
        this.lx[index] = loop[k].x;
        this.ly[index] = loop[k].y;
        this.next[index] = k === loop.length - 1 ? start : index + 1;
        this.prev[index] = k === 0 ? start + loop.length - 1 : index - 1;
      }
    }
    this.loopStarts.push(n);

    // Area & centroid. Soft bodies use the mean of their points, which is
    // what shape matching tracks. Others use the true area centroid.
    let cross2 = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      const j = this.next[i];
      const c = this.lx[i] * this.ly[j] - this.lx[j] * this.ly[i];
      cross2 += c;
      cx += (this.lx[i] + this.lx[j]) * c;
      cy += (this.ly[i] + this.ly[j]) * c;
    }
    const area = cross2 / 2;
    if (this.isSoft) {
      cx = 0;
      cy = 0;
      for (let i = 0; i < n; i++) {
        cx += this.lx[i];
        cy += this.ly[i];
      }
      cx /= n;
      cy /= n;
    } else {
      cx /= 3 * cross2;
      cy /= 3 * cross2;
    }
    for (let i = 0; i < n; i++) {
      this.lx[i] -= cx;
      this.ly[i] -= cy;
    }
    this.restArea = area;

    // Mass
    const mass = options.mass ?? Math.abs(area) * (options.density ?? 0.001);
    this.mass = this.isStatic ? Infinity : mass;
    this.inverseMass = this.isStatic ? 0 : 1 / mass;
    this.pointMass = mass / n;
    let inertiaSum = 0;
    for (let i = 0; i < n; i++) {
      const j = this.next[i];
      const ax = this.lx[i];
      const ay = this.ly[i];
      const bx = this.lx[j];
      const by = this.ly[j];
      inertiaSum += (ax * by - bx * ay) * (ax * ax + ax * bx + bx * bx + ay * ay + ay * by + by * by);
    }
    const inertia = (mass * inertiaSum) / (6 * cross2);
    this.inertia = this.isStatic ? Infinity : inertia;
    this.inverseInertia = this.isStatic || !(inertia > 0) ? 0 : 1 / inertia;
    this.pointInvMass.fill(this.isStatic ? 0 : 1 / this.pointMass);

    this.friction = options.friction ?? 0.4;
    this.restitution = options.restitution ?? 0;
    this.airFriction = options.airFriction ?? 0.05;
    this.gravityScale = options.gravityScale ?? 1;
    this.collisionFilter = {
      category: options.collisionFilter?.category ?? 1,
      mask: options.collisionFilter?.mask ?? 0xffffffff,
      group: options.collisionFilter?.group ?? 0,
    };

    // Soft tuning
    const defaults = SOFT_DEFAULTS[this.kind === "rigid" ? "shape" : this.kind];
    const m = this.pointMass;
    // Gas fills the outer contours only. In 2D, gas pushing on the contour of a
    // hole would compress it until it buckles. Holes keep their shape with
    // their edges and some shape matching (a tire is a balloon with a rim).
    let gasArea = 0;
    for (let k = 0; k < loops.length; k++) {
      const loopArea = signedArea(loops[k]);
      if (loopArea > 0) {
        this.gasLoops.push(this.loopStarts[k], this.loopStarts[k + 1]);
        gasArea += loopArea;
      }
    }
    this.gasRestArea = gasArea;
    const hasHoles = this.gasLoops.length / 2 < loops.length;
    const shapeDefault = this.kind === "pressure" && hasHoles ? HOLE_SHAPE_STIFFNESS : defaults.shapeStiffness;
    this.shapeStiffness = (options.shapeStiffness ?? shapeDefault) * m;
    this.shapeDamping = (options.shapeDamping ?? defaults.shapeDamping) * m;
    const pressure = options.pressure ?? defaults.pressure;
    this.pressure = pressure * m;
    this.inflation = options.inflation ?? 1;
    if (this.isSoft) {
      const edgeK = options.edgeStiffness ?? defaults.edgeStiffness;
      const edgeD = options.edgeDamping ?? defaults.edgeDamping;
      for (let k = 0; k < this.loopStarts.length - 1; k++) {
        const start = this.loopStarts[k];
        const end = this.loopStarts[k + 1];
        // Pre-tension outer edges so that the gas pressure is balanced at rest
        // (like a balloon skin). Laplace's law: tension = pressure * radius,
        // with radius = 2 * area / perimeter. Edges are stiffened if needed so
        // that pre-tension stays below MAX_PRESTRETCH of their length (big
        // bodies need more tension).
        let tension = 0;
        let loopK = edgeK;
        if (pressure !== 0 && edgeK > 0 && signedArea(loops[k]) > 0) {
          let perimeter = 0;
          let loopCross2 = 0;
          for (let i = start; i < end; i++) {
            const j = this.next[i];
            perimeter += Math.hypot(this.lx[j] - this.lx[i], this.ly[j] - this.ly[i]);
            loopCross2 += this.lx[i] * this.ly[j] - this.lx[j] * this.ly[i];
          }
          tension = (pressure * loopCross2) / perimeter;
          const meanLength = perimeter / (end - start);
          const needed = Math.abs(tension) / (MAX_PRESTRETCH * meanLength);
          loopK = Math.max(edgeK, Math.min(needed, MAX_EDGE_STIFFNESS));
        }
        for (let i = start; i < end; i++) {
          const j = this.next[i];
          const length = Math.hypot(this.lx[j] - this.lx[i], this.ly[j] - this.ly[i]);
          this.addSpring(i, j, loopK, edgeD, Math.max(length * 0.05, length - tension / loopK));
        }
      }
      const bendK = options.bendStiffness ?? defaults.bendStiffness;
      if (bendK > 0) {
        const bendD = options.bendDamping ?? defaults.bendDamping;
        for (let i = 0; i < n; i++) {
          const j = this.next[this.next[i]];
          if (j !== i) this.addSpring(i, j, bendK, bendD);
        }
      }
    }

    // Placement
    this.x = this.toX = options.x ?? 0;
    this.y = this.toY = options.y ?? 0;
    this.angle = this.toAngle = options.angle ?? 0;
    this.cos = Math.cos(this.angle);
    this.sin = Math.sin(this.angle);
    for (let i = 0; i < n; i++) {
      this.px[i] = this.x + this.cos * this.lx[i] - this.sin * this.ly[i];
      this.py[i] = this.y + this.sin * this.lx[i] + this.cos * this.ly[i];
    }
    this.resetInterpolation();
    this.updateBounds();
  }

  /**
   * Adds an internal spring between two points of this body.
   * Stiffness and damping are normalized by point mass.
   */
  addSpring(a: number, b: number, stiffness: number, damping = 0, restLength?: number) {
    const rest = restLength ?? Math.hypot(this.lx[b] - this.lx[a], this.ly[b] - this.ly[a]);
    this.springA.push(a);
    this.springB.push(b);
    this.springRest.push(rest);
    this.springK.push(stiffness * this.pointMass);
    this.springD.push(damping * this.pointMass);
  }

  /** Current area of the material (holes subtracted). */
  get area() {
    const { px, py, next } = this;
    let cross2 = 0;
    for (let i = 0; i < this.pointCount; i++) {
      const j = next[i];
      cross2 += px[i] * py[j] - px[j] * py[i];
    }
    return cross2 / 2;
  }

  /**
   * Static & kinematic bodies move smoothly to this position during the next
   * step (pushing what is in the way) unless `teleport` is true.
   * Dynamic bodies are always teleported.
   */
  setPosition(x: number, y: number, teleport = false) {
    if ((this.isStatic || this.kinematic) && !teleport) {
      this.toX = x;
      this.toY = y;
      this.pendingDrive = true;
      return;
    }
    this.transformTo(x, y, this.angle);
  }

  setAngle(angle: number, teleport = false) {
    if ((this.isStatic || this.kinematic) && !teleport) {
      this.toAngle = angle;
      this.pendingDrive = true;
      return;
    }
    this.transformTo(this.x, this.y, angle);
  }

  setVelocity(vx: number, vy: number) {
    if (this.isStatic) return;
    const dx = vx - this.velocityX;
    const dy = vy - this.velocityY;
    this.velocityX = vx;
    this.velocityY = vy;
    for (let i = 0; i < this.pointCount; i++) {
      this.vx[i] += dx;
      this.vy[i] += dy;
    }
  }

  setAngularVelocity(omega: number) {
    if (this.isStatic) return;
    const dw = omega - this.angularVelocity;
    this.angularVelocity = omega;
    for (let i = 0; i < this.pointCount; i++) {
      this.vx[i] -= dw * (this.py[i] - this.y);
      this.vy[i] += dw * (this.px[i] - this.x);
    }
  }

  /** Force applied at the centroid during the next step. */
  applyForce(fx: number, fy: number) {
    this.forceX += fx;
    this.forceY += fy;
  }

  applyTorque(torque: number) {
    this.torque += torque;
  }

  /** Instant change of momentum, applied at the centroid. */
  applyImpulse(ix: number, iy: number) {
    if (this.isStatic) return;
    this.setVelocity(this.velocityX + ix * this.inverseMass, this.velocityY + iy * this.inverseMass);
  }

  containsPoint(x: number, y: number) {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) return false;
    const { px, py, next } = this;
    let inside = false;
    for (let i = 0; i < this.pointCount; i++) {
      const j = next[i];
      const y1 = py[i];
      const y2 = py[j];
      if (y1 > y !== y2 > y && x < px[i] + ((y - y1) * (px[j] - px[i])) / (y2 - y1)) inside = !inside;
    }
    return inside;
  }

  /** Index of the point closest to (x, y). */
  closestPoint(x: number, y: number) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.pointCount; i++) {
      const d = (this.px[i] - x) ** 2 + (this.py[i] - y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  updateBounds() {
    const { px, py } = this;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < this.pointCount; i++) {
      const x = px[i];
      const y = py[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  // ---------------------------------------------------------------------------
  // Simulation internals, called by World
  // ---------------------------------------------------------------------------

  /** @internal */
  beginStep(dt: number) {
    this.prevX.set(this.px);
    this.prevY.set(this.py);
    if (!this.isStatic && !this.kinematic) return;

    if (this.pendingDrive) {
      this.pendingDrive = false;
      this.driving = true;
      this.fromX = this.x;
      this.fromY = this.y;
      this.fromAngle = this.angle;
      this.velocityX = (this.toX - this.x) / dt;
      this.velocityY = (this.toY - this.y) / dt;
      this.angularVelocity = (this.toAngle - this.angle) / dt;
    } else if (this.driving) {
      this.driving = false;
      this.velocityX = 0;
      this.velocityY = 0;
      this.angularVelocity = 0;
      if (this.isStatic) {
        this.vx.fill(0);
        this.vy.fill(0);
      }
    }
  }

  /** @internal Moves static/kinematic frames, `fraction` going from 0 to 1 across the step. */
  drive(fraction: number) {
    if (!this.driving) return;
    this.x = this.fromX + (this.toX - this.fromX) * fraction;
    this.y = this.fromY + (this.toY - this.fromY) * fraction;
    this.angle = this.fromAngle + (this.toAngle - this.fromAngle) * fraction;
    this.cos = Math.cos(this.angle);
    this.sin = Math.sin(this.angle);
    if (this.isStatic) this.syncPointsFromFrame();
  }

  /** @internal */
  accumulateForces() {
    if (this.isStatic) return;
    const { fx, fy } = this;
    fx.fill(0);
    fy.fill(0);
    if (this.isRigid) return;

    const { px, py, vx, vy } = this;

    // Springs
    const { springA, springB, springRest, springK, springD } = this;
    for (let s = 0; s < springA.length; s++) {
      const a = springA[s];
      const b = springB[s];
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1e-9) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const f = springK[s] * (dist - springRest[s]) + springD[s] * ((vx[b] - vx[a]) * nx + (vy[b] - vy[a]) * ny);
      fx[a] += f * nx;
      fy[a] += f * ny;
      fx[b] -= f * nx;
      fy[b] -= f * ny;
    }

    // Gas pressure: each edge is pushed along its outward normal, proportionally
    // to its length. (ey, -ex) is exactly normal * length.
    if (this.pressure !== 0 && this.gasRestArea > 0) {
      const { next, gasLoops } = this;
      let cross2 = 0;
      for (let k = 0; k < gasLoops.length; k += 2) {
        for (let i = gasLoops[k]; i < gasLoops[k + 1]; i++) {
          const j = next[i];
          cross2 += px[i] * py[j] - px[j] * py[i];
        }
      }
      const area = Math.max(cross2 / 2, this.gasRestArea * 0.1);
      const half = (0.5 * this.pressure * this.inflation * this.gasRestArea) / area;
      for (let k = 0; k < gasLoops.length; k += 2) {
        for (let i = gasLoops[k]; i < gasLoops[k + 1]; i++) {
          const j = next[i];
          const ex = px[j] - px[i];
          const ey = py[j] - py[i];
          fx[i] += ey * half;
          fy[i] -= ex * half;
          fx[j] += ey * half;
          fy[j] -= ex * half;
        }
      }
    }

    // Shape matching: springs towards the rest shape, translated and rotated
    // to best fit the current points. The damping alone (without stiffness)
    // damps every deformation mode without slowing down the body as a whole.
    if (this.shapeStiffness !== 0 || this.shapeDamping !== 0) {
      if (!this.kinematic) this.updateFrame();
      const { lx, ly } = this;
      const k = this.shapeStiffness;
      const d = this.shapeDamping;
      const c = this.cos;
      const s = this.sin;
      const w = this.angularVelocity;
      for (let i = 0; i < this.pointCount; i++) {
        const rx = c * lx[i] - s * ly[i];
        const ry = s * lx[i] + c * ly[i];
        fx[i] += k * (this.x + rx - px[i]) + d * (this.velocityX - w * ry - vx[i]);
        fy[i] += k * (this.y + ry - py[i]) + d * (this.velocityY + w * rx - vy[i]);
      }
    }
  }

  /** @internal Semi-implicit Euler. */
  integrate(h: number, gx: number, gy: number) {
    if (this.isStatic) return;
    const drag = 1 / (1 + this.airFriction * h);
    gx *= this.gravityScale;
    gy *= this.gravityScale;
    const { px, py, vx, vy, fx, fy } = this;

    if (this.isRigid) {
      let forceX = this.forceX;
      let forceY = this.forceY;
      let torque = this.torque;
      for (let i = 0; i < this.pointCount; i++) {
        const f1 = fx[i];
        const f2 = fy[i];
        if (f1 === 0 && f2 === 0) continue;
        forceX += f1;
        forceY += f2;
        torque += (px[i] - this.x) * f2 - (py[i] - this.y) * f1;
      }
      this.velocityX = (this.velocityX + (forceX * this.inverseMass + gx) * h) * drag;
      this.velocityY = (this.velocityY + (forceY * this.inverseMass + gy) * h) * drag;
      this.angularVelocity = (this.angularVelocity + torque * this.inverseInertia * h) * drag;
      this.x += this.velocityX * h;
      this.y += this.velocityY * h;
      this.angle += this.angularVelocity * h;
      this.cos = Math.cos(this.angle);
      this.sin = Math.sin(this.angle);
      this.syncPointsFromFrame();
      return;
    }

    const ax = this.forceX * this.inverseMass + gx;
    const ay = this.forceY * this.inverseMass + gy;
    const { pointInvMass } = this;
    for (let i = 0; i < this.pointCount; i++) {
      const w = pointInvMass[i];
      if (w === 0) {
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] = (vx[i] + (fx[i] * w + ax) * h) * drag;
      vy[i] = (vy[i] + (fy[i] * w + ay) * h) * drag;
      px[i] += vx[i] * h;
      py[i] += vy[i] * h;
    }
  }

  /** @internal Places points (and their velocities) according to the frame. */
  syncPointsFromFrame() {
    const { px, py, vx, vy, lx, ly } = this;
    const c = this.cos;
    const s = this.sin;
    const w = this.angularVelocity;
    for (let i = 0; i < this.pointCount; i++) {
      const rx = c * lx[i] - s * ly[i];
      const ry = s * lx[i] + c * ly[i];
      px[i] = this.x + rx;
      py[i] = this.y + ry;
      vx[i] = this.velocityX - w * ry;
      vy[i] = this.velocityY + w * rx;
    }
  }

  /** @internal Derives the frame of a soft body from its points. */
  updateFrame() {
    const { px, py, vx, vy, lx, ly } = this;
    const n = this.pointCount;
    let cx = 0;
    let cy = 0;
    let mvx = 0;
    let mvy = 0;
    for (let i = 0; i < n; i++) {
      cx += px[i];
      cy += py[i];
      mvx += vx[i];
      mvy += vy[i];
    }
    cx /= n;
    cy /= n;
    mvx /= n;
    mvy /= n;

    // Optimal rotation (2D Procrustes) + angular velocity (L / I)
    let dot = 0;
    let cross = 0;
    let momentum = 0;
    let inertia = 0;
    for (let i = 0; i < n; i++) {
      const qx = px[i] - cx;
      const qy = py[i] - cy;
      dot += lx[i] * qx + ly[i] * qy;
      cross += lx[i] * qy - ly[i] * qx;
      momentum += qx * (vy[i] - mvy) - qy * (vx[i] - mvx);
      inertia += qx * qx + qy * qy;
    }

    this.x = cx;
    this.y = cy;
    this.velocityX = mvx;
    this.velocityY = mvy;
    this.angularVelocity = inertia > 0 ? momentum / inertia : 0;
    if (dot !== 0 || cross !== 0) {
      let delta = Math.atan2(cross, dot) - this.angle;
      delta -= Math.round(delta / TAU) * TAU;
      this.angle += delta;
      const len = Math.sqrt(dot * dot + cross * cross);
      this.cos = dot / len;
      this.sin = cross / len;
    }
  }

  /** @internal */
  endStep() {
    this.forceX = 0;
    this.forceY = 0;
    this.torque = 0;
    if (this.isSoft && !this.kinematic) this.updateFrame();
  }

  /** @internal */
  resetInterpolation() {
    this.prevX.set(this.px);
    this.prevY.set(this.py);
    this.rx.set(this.px);
    this.ry.set(this.py);
  }

  private transformTo(x: number, y: number, angle: number) {
    const dAngle = angle - this.angle;
    const c = Math.cos(dAngle);
    const s = Math.sin(dAngle);
    const { px, py, vx, vy } = this;
    for (let i = 0; i < this.pointCount; i++) {
      const rx = px[i] - this.x;
      const ry = py[i] - this.y;
      px[i] = x + c * rx - s * ry;
      py[i] = y + s * rx + c * ry;
      const wx = vx[i];
      vx[i] = c * wx - s * vy[i];
      vy[i] = s * wx + c * vy[i];
    }
    if (this.isStatic) {
      this.vx.fill(0);
      this.vy.fill(0);
    }
    this.x = this.toX = x;
    this.y = this.toY = y;
    this.angle = this.toAngle = angle;
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.resetInterpolation();
    this.updateBounds();
  }
}

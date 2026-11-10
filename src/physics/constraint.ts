import type { Body } from "./body.ts";

export interface SpringOptions {
  bodyA: Body;
  pointA: number;
  /** Second body. When omitted, the spring is attached to a world anchor (x, y). */
  bodyB?: Body | null;
  pointB?: number;
  x?: number;
  y?: number;
  /** Rest length. Defaults to the current distance. */
  length?: number;
  /** Normalized by the effective mass of the attached points (it is an acceleration). */
  stiffness?: number;
  damping?: number;
}

/** Inverse mass seen by a force applied at point i (upper bound for rigid bodies). */
function invMassAt(body: Body, i: number) {
  if (body.isStatic) return 0;
  if (body.isRigid) {
    const rx = body.px[i] - body.x;
    const ry = body.py[i] - body.y;
    return body.inverseMass + (rx * rx + ry * ry) * body.inverseInertia;
  }
  return body.pointInvMass[i];
}

/**
 * Damped spring between a point of a body and either a point of another body
 * or a fixed world anchor (pointer dragging, ropes, pins, wheels...).
 * Use `length: 0` to pin points together.
 */
export class Spring {
  bodyA: Body;
  pointA: number;
  bodyB: Body | null;
  pointB: number;
  anchorX: number;
  anchorY: number;
  length: number;
  stiffness: number;
  damping: number;

  constructor(options: SpringOptions) {
    this.bodyA = options.bodyA;
    this.pointA = options.pointA;
    this.bodyB = options.bodyB ?? null;
    this.pointB = options.pointB ?? 0;
    this.anchorX = options.x ?? this.bodyA.px[this.pointA];
    this.anchorY = options.y ?? this.bodyA.py[this.pointA];
    this.stiffness = options.stiffness ?? 1000;
    this.damping = options.damping ?? 20;
    const [bx, by] = this.endB();
    this.length = options.length ?? Math.hypot(bx - this.bodyA.px[this.pointA], by - this.bodyA.py[this.pointA]);
  }

  setAnchor(x: number, y: number) {
    this.anchorX = x;
    this.anchorY = y;
  }

  private endB(): [number, number] {
    const B = this.bodyB;
    return B ? [B.px[this.pointB], B.py[this.pointB]] : [this.anchorX, this.anchorY];
  }

  /** @internal */
  apply() {
    const A = this.bodyA;
    const B = this.bodyB;
    const i = this.pointA;
    const j = this.pointB;
    const wA = invMassAt(A, i);
    const wB = B ? invMassAt(B, j) : 0;
    if (wA + wB === 0) return;

    const dx = (B ? B.px[j] : this.anchorX) - A.px[i];
    const dy = (B ? B.py[j] : this.anchorY) - A.py[i];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-9) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const relVel = ((B ? B.vx[j] : 0) - A.vx[i]) * nx + ((B ? B.vy[j] : 0) - A.vy[i]) * ny;
    const f = (this.stiffness * (dist - this.length) + this.damping * relVel) / (wA + wB);

    if (wA !== 0) {
      A.fx[i] += f * nx;
      A.fy[i] += f * ny;
    }
    if (B && wB !== 0) {
      B.fx[j] -= f * nx;
      B.fy[j] -= f * ny;
    }
  }
}

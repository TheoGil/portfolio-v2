import { Body } from "./body.ts";
import {
  canCollide,
  ContactList,
  detect,
  prepareVelocity,
  solvePosition,
  solveVelocity,
  storeImpulses,
} from "./collision.ts";
import type { Spring } from "./constraint.ts";
import type { Vec2 } from "./shapes.ts";

export interface WorldOptions {
  /** In px/s². */
  gravity?: Vec2;
  /** Sub-steps per step. More is stiffer and more stable, but slower. */
  substeps?: number;
  /** Velocity solver iterations per sub-step. */
  iterations?: number;
  /** Max distance to keep pushing a point through the edge it touched at the previous sub-step (see `detect`). */
  penetrationThreshold?: number;
  /** Tolerated penetration, reduces jitter of resting bodies. */
  slop?: number;
}

export class World {
  readonly bodies: Body[] = [];
  readonly springs: Spring[] = [];
  /** Contacts found during the last sub-step. */
  readonly contacts = new ContactList();
  gravity: Vec2;
  substeps: number;
  iterations: number;
  penetrationThreshold: number;
  slop: number;

  private sorted: Body[] = [];
  /** Sub-step counter, used to match contacts between sub-steps. */
  private stamp = 0;

  constructor(options: WorldOptions = {}) {
    this.gravity = options.gravity ?? { x: 0, y: 1000 };
    this.substeps = options.substeps ?? 2;
    this.iterations = options.iterations ?? 4;
    this.penetrationThreshold = options.penetrationThreshold ?? 30;
    this.slop = options.slop ?? 0.05;
  }

  add(...items: (Body | Spring)[]) {
    for (const item of items) {
      if (item instanceof Body) {
        if (this.bodies.includes(item)) continue;
        this.bodies.push(item);
        this.sorted.push(item);
      } else if (!this.springs.includes(item)) {
        this.springs.push(item);
      }
    }
    return this;
  }

  /** Removes bodies and springs. Springs attached to removed bodies are removed too. */
  remove(...items: (Body | Spring)[]) {
    for (const item of items) {
      if (item instanceof Body) {
        removeItem(this.bodies, item);
        removeItem(this.sorted, item);
        for (let s = this.springs.length - 1; s >= 0; s--) {
          const spring = this.springs[s];
          if (spring.bodyA === item || spring.bodyB === item) this.springs.splice(s, 1);
        }
      } else {
        removeItem(this.springs, item);
      }
    }
    return this;
  }

  clear() {
    this.bodies.length = 0;
    this.sorted.length = 0;
    this.springs.length = 0;
    this.contacts.clear();
  }

  /** Advances the simulation by `dt` seconds. Use a fixed `dt` (see Runner). */
  step(dt: number) {
    if (!(dt > 0)) return;
    const { bodies, springs } = this;
    const substeps = Math.max(1, Math.floor(this.substeps));
    const h = dt / substeps;
    const gx = this.gravity.x;
    const gy = this.gravity.y;

    for (const body of bodies) body.beginStep(dt);

    for (let s = 1; s <= substeps; s++) {
      const fraction = s / substeps;
      for (const body of bodies) body.drive(fraction);
      for (const body of bodies) body.accumulateForces();
      for (const spring of springs) spring.apply();
      for (const body of bodies) {
        body.integrate(h, gx, gy);
        body.updateBounds();
      }
      this.collide(h);
    }

    for (const body of bodies) body.endStep();
  }

  /** Fills `body.rx/ry` with positions interpolated between the last two steps. */
  interpolate(alpha: number) {
    for (const body of this.bodies) {
      const { prevX, prevY, px, py, rx, ry } = body;
      for (let i = 0; i < body.pointCount; i++) {
        rx[i] = prevX[i] + (px[i] - prevX[i]) * alpha;
        ry[i] = prevY[i] + (py[i] - prevY[i]) * alpha;
      }
    }
  }

  /** Bodies containing the point, topmost (last added) first. */
  bodiesAt(x: number, y: number) {
    const found: Body[] = [];
    for (let b = this.bodies.length - 1; b >= 0; b--) {
      if (this.bodies[b].containsPoint(x, y)) found.push(this.bodies[b]);
    }
    return found;
  }

  private collide(h: number) {
    const { sorted, contacts } = this;
    contacts.clear();

    // Broad phase: sweep and prune on x. Insertion sort is ~O(n) since the
    // order barely changes between sub-steps.
    for (let i = 1; i < sorted.length; i++) {
      const body = sorted[i];
      let j = i - 1;
      while (j >= 0 && sorted[j].minX > body.minX) {
        sorted[j + 1] = sorted[j];
        j--;
      }
      sorted[j + 1] = body;
    }

    for (let i = 0; i < sorted.length; i++) {
      const A = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const B = sorted[j];
        if (B.minX > A.maxX) break;
        if (B.minY > A.maxY || B.maxY < A.minY) continue;
        if (A.isStatic && B.isStatic) continue;
        if (!canCollide(A.collisionFilter, B.collisionFilter)) continue;
        detect(A, B, contacts, this.penetrationThreshold, h, this.stamp);
        detect(B, A, contacts, this.penetrationThreshold, h, this.stamp);
      }
    }

    const items = contacts.items;
    const count = contacts.count;
    const stamp = ++this.stamp;
    for (let c = 0; c < count; c++) solvePosition(items[c], this.slop);
    for (let c = 0; c < count; c++) prepareVelocity(items[c], stamp);
    for (let it = 0; it < this.iterations; it++) {
      for (let c = 0; c < count; c++) solveVelocity(items[c]);
    }
    for (let c = 0; c < count; c++) storeImpulses(items[c], stamp);

    for (const body of this.bodies) {
      if (body.isRigid) body.syncPointsFromFrame();
    }
  }
}

function removeItem<T>(list: T[], item: T) {
  const index = list.indexOf(item);
  if (index >= 0) list.splice(index, 1);
}

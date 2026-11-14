# Soft body physics

A small 2D physics engine (no dependencies, ~8 KB gzipped) for soft bodies, inspired by the JellyCar engine. It is built for small creative web experiences: it favors speed and fun over physical accuracy. Rendering is not part of it.

Demo: `blob.html` / `src/blob.ts` (drag bodies, click to spawn, `D` wireframe, `R` reset, space pause).

## Usage

```ts
import { Bodies, Runner, Shapes, Spring, World } from "./physics/index.ts";

const world = new World({ gravity: { x: 0, y: 1000 } }); // px/s²

world.add(
  Bodies.rectangle(400, 620, 800, 40, { isStatic: true }),
  Bodies.rectangle(200, 100, 80, 80), // rigid (default)
  Bodies.circle(300, 100, 50, { kind: "pressure" }), // gas filled
  Bodies.star(500, 100, 5, 60, 30, { kind: "shape" }), // shape matching
  Bodies.ring(600, 100, 60, 30, { kind: "shape" }), // body with a hole
  Bodies.compound(700, 100, [Shapes.rectangle(20, 60), Shapes.translate(Shapes.circle(12), 0, -50)]),
);

new Runner(world, {
  onRender: () => {
    for (const body of world.bodies) draw(body); // use body.rx / body.ry
  },
}).start();
```

### Rendering a body

Interpolated positions are in `body.rx` / `body.ry` (simulation positions are in `px` / `py`). A body is made of one or more closed loops: loop `k` spans points `loopStarts[k]` to `loopStarts[k + 1] - 1`. Fill with the even-odd rule so that holes stay empty:

```ts
ctx.beginPath();
for (let k = 0; k < body.loopStarts.length - 1; k++) {
  const start = body.loopStarts[k];
  ctx.moveTo(body.rx[start], body.ry[start]);
  for (let i = start + 1; i < body.loopStarts[k + 1]; i++) ctx.lineTo(body.rx[i], body.ry[i]);
  ctx.closePath();
}
ctx.fill("evenodd");
```

`body.x`, `body.y`, `body.angle` give the frame of any body, including soft ones (best fit of the points).

To attach drawings to a body (faces, sprites, decals), use `body.getTransform(deformation)`. It maps the rest shape (origin at the centroid, unrotated) to the rendered points, is interpolated like them, and follows soft bodies. `deformation` blends from rotation only (0) to also following squash and stretch (1):

```ts
const t = body.getTransform(0.7);
ctx.save();
ctx.transform(t.a, t.b, t.c, t.d, t.e, t.f);
drawFace(ctx, 0, -20); // in rest shape coordinates
ctx.restore();
```

## Bodies

| `kind` | Kept in shape by | Good for |
| --- | --- | --- |
| `rigid` (default) | rigid frame: points follow it exactly | boxes, props, letters |
| `pressure` | pre-tensioned edge springs + gas pressure | balloons, blobs, tires |
| `shape` | edge springs + springs towards the rest shape (shape matching) | jelly, any shape |

`isStatic: true` makes any body static: not simulated, but it can be moved with `setPosition` / `setAngle` and pushes things smoothly (moving platforms). A `shape` body with `kinematic: true` has its rest frame driven by `setPosition` / `setAngle`: a squishy moving platform.

Shapes are lists of loops, read with the even-odd rule: a loop inside another one is a hole, disjoint loops make a compound body. Loops must not overlap. Helpers: `Shapes.rectangle / circle / ellipse / polygon / star / ring / fromVertices / combine / translate / rotate / scale / subdivide`, and the matching `Bodies.*` factories, plus `Bodies.compound` and `Bodies.fromShape`.

### Options

| Option | Default | |
| --- | --- | --- |
| `x`, `y`, `angle` | 0 | position of the centroid |
| `mass` / `density` | area × 0.001 | |
| `friction` | 0.4 | Coulomb, combined as √(a·b) |
| `restitution` | 0 | bounciness, combined as max(a, b) |
| `airFriction` | 0.05 | velocity damping, 1/s |
| `gravityScale` | 1 | |
| `segmentLength` | 16 for soft, 0 otherwise | edges longer than this are subdivided |
| `edgeStiffness`, `edgeDamping` | 2500 / 1500, 12 | edge springs |
| `bendStiffness`, `bendDamping` | 0 | springs between points i and i+2 |
| `shapeStiffness`, `shapeDamping` | 0 / 600, 8 / 12 | shape matching (damping alone damps deformation only) |
| `pressure` | 600 | firmness of `pressure` bodies |
| `inflation` | 1 | gas amount, > 1 inflates, < 1 deflates (can be changed live) |
| `collisionFilter` | `{ category: 1, mask: all, group: 0 }` | same semantics as matter.js |

Stiffness and damping values are normalized by point mass (they are accelerations), so a body behaves the same whatever its size or mass. `Body.addSpring(a, b, stiffness, damping)` adds internal springs.

### Methods

`setPosition`, `setAngle`, `setVelocity`, `setAngularVelocity`, `setPressure`, `applyForce`, `applyTorque`, `applyImpulse`, `containsPoint`, `closestPoint`, `getTransform`, `area`.

`setPressure` changes the firmness of a soft body live and re-tensions its edges, so it keeps its size (assigning `body.pressure` directly would inflate or deflate it).

## Springs

`Spring` links a point of a body to a point of another body, or to a world anchor (pointer dragging, ropes, pins). `length: 0` pins the points together.

```ts
const drag = new Spring({ bodyA: body, pointA: body.closestPoint(x, y), x, y, length: 0, stiffness: 400, damping: 25 });
world.add(drag);
drag.setAnchor(pointerX, pointerY);
world.remove(drag);
```

## World & Runner

- `World({ gravity, substeps = 2, iterations = 4, slop = 0.05, penetrationThreshold = 30 })`
- `world.step(dt)`: advance by a fixed `dt`, split into `substeps`.
- `world.bodiesAt(x, y)`, `world.contacts` (contacts of the last sub-step).
- `Runner(world, { fixedDelta = 1/120, maxSteps = 8, interpolate = true, onStep, onRender })`: frame-rate independent loop with a fixed time step, accumulator and interpolation. `timeScale` for slow motion, `tick(time)` to drive it manually.

## How it works

Every body, rigid ones included, is a set of points on closed loops, so a single collision method handles every pair.

1. **Forces**: springs (Hooke + damping), gas pressure and shape matching, then semi-implicit Euler integration. Rigid bodies sum forces and torques on their frame (true mass and inertia of the polygon) and place their points from it.
2. **Detection**: sweep and prune on bounding boxes, then each point of A is tested against the polygon of B (even-odd ray casting) and vice versa.
3. **Edge to push out through**: the edge crossed by the point's motion relative to B during the sub-step, else the edge it touched at the previous sub-step, else the closest edge.
4. **Resolution**: position correction (PBD style, on current positions), then sequential impulses with accumulated, clamped impulses, Coulomb friction and warm starting. Each side of a contact is a soft point, a soft edge (lever between both ends), a rigid body (effective mass at the contact point) or a static body.

### Differences with JellyCar

- **Pressure**: edges are pre-tensioned so that the gas is balanced at rest (Laplace's law). Bodies keep their authored size, and `pressure` directly sets firmness, independently of size. Gas fills the outer loops only: in 2D, gas would crush holes.
- **Shape matching**: the rotation is the exact least squares fit (2D Procrustes) instead of an average of angles. Its damping is relative to the rigid motion of the frame, so it does not slow down the body as a whole.
- **Collisions**: the entry edge and previous edge replace the "edge facing the point normal" heuristic, which pushed points out through the wrong side of thin bodies. Friction is Coulomb and impulses go through a proper solver, so rigid bodies stack.
- **Rigid bodies** are real rigid bodies, not stiff soft bodies.

## Limits

- No continuous collision detection: a small, very fast body can go through a thin one. Subdivide thin static bodies (`segmentLength`) so their points help.
- Parts of a compound body must not overlap (the overlap would be read as a hole).
- Explicit integration: very high stiffness needs more `substeps`.
- Cost grows with points in contact: around 100 bodies (~1,200 points) cost ~7 ms per frame.
- Not yet: sleeping, raycasts, triggers, weld/axle joints.

# Technical Summary: Physics of JellyCar (Soft Body Physics Engine)

## Executive Architecture & Core Philosophy

The soft-body physics engine powering the *JellyCar* series achieves its characteristic squishy, deformable physical interactions without relying on complex 3D continuous volumetric meshes or finite element modeling. Instead, the engine operates on a lightweight discrete system composed of fundamental mathematical primitives: zero-dimensional point masses, boundary line segments, linear springs, gas pressure equations, rigid shape-matching frames, and geometric constraints.

By building complex physical phenomena out of modular, deterministic primitives, the engine achieves real-time soft-body interactions suitable for interactive gameplay.

---

## 1. Point Masses & Shape Representation

### Point Mass Primitives
The foundational unit of the simulation is the point mass. A point mass represents a single discrete zero-dimensional node in 2D space defined by three primary properties:
* **Position Vector**: $\vec{p} = (x, y)$
* **Velocity Vector**: $\vec{v} = (v_x, v_y)$
* **Mass Quantity**: $m$

External scalar and vector forces, such as gravity ($\vec{g}$), act upon the point mass to modify its velocity, which sequentially updates its position over discrete numerical integration time steps. Crucially, an isolated point mass possesses no native collision geometry or rotational inertia.

### Shape Definition via Ordered Vertices
To form recognizable physical bodies, individual point masses are grouped into an ordered list:

$$S = \{\vec{p}_0, \vec{p}_1, \vec{p}_2, \dots, \vec{p}_{n-1}\}$$

Connecting adjacent point masses sequentially with straight line segments—from $\vec{p}_0$ to $\vec{p}_1$, $\vec{p}_1$ to $\vec{p}_2$, and closing from $\vec{p}_{n-1}$ to $\vec{p}_0$—defines the outer boundary polygon of the physical object.

---

## 2. Collision Detection: Point-in-Polygon Testing

### Overlap Detection Protocol
Because objects consist of discrete vertex nodes and boundary segments, collision detection relies on testing spatial enclosure rather than continuous volumetric intersections. Overlap between Object $A$ and Object $B$ is determined bilaterally:

1. Test every point mass of Object $A$ to evaluate whether it lies inside the boundary polygon of Object $B$.
2. Test every point mass of Object $B$ to evaluate whether it lies inside the boundary polygon of Object $A$.

### Ray-Casting & Parity Test (Even-Odd Rule)
To test whether a candidate point $\vec{p}_t$ resides within a simple, non-self-intersecting closed polygon:

1. **Exterior Target Point Determination**: Construct a reference point $\vec{p}_{out}$ guaranteed to lie outside the polygon. This is accomplished by leveraging the object's Axis-Aligned Bounding Box (AABB) and projecting horizontally to the right beyond the maximum X-coordinate ($X_{max} + \epsilon$).
2. **Ray Construction**: Cast a horizontal ray starting from $\vec{p}_t$ and extending to $\vec{p}_{out}$.
3. **Intersection Counting**: Count the total number of edge segment intersections $N_{int}$ along the ray path.
4. **Parity Rule**:
   * If $N_{int}$ is **odd**, $\vec{p}_t$ originated **inside** the polygon.
   * If $N_{int}$ is **even**, $\vec{p}_t$ originated **outside** the polygon.

Restricting the test ray to a strictly horizontal direction simplifies line-segment intersection checks into fast scalar comparisons.

### Boundary Edge Cases & Straddling Traps
The discrete point-in-polygon algorithm exhibits a known failure mode when a fast-moving or narrow object straddle-collides with a thin obstacle. If two sides of an object pass on opposite sides of a thin barrier such that no individual vertex resides inside the obstacle's boundary polygon, the point-in-polygon test fails to detect the collision.

The engine deliberately tolerates this edge case because discrete step-by-step temporal simulation typically captures at least one vertex inside the obstacle prior to full straddling, allowing collision resolution to trigger naturally before failure occurs.

---

## 3. Collision Resolution & Velocity Impulse Updates

When a point mass $\vec{p}_A$ of Object $A$ is detected inside Object $B$, two distinct resolution stages are executed: positional penetration correction and velocity impulse distribution.

### Positional Penetration Correction
To remove $\vec{p}_A$ from the interior of Object $B$:

1. Identify the closest boundary line segment $E = (\vec{p}_{B1}, \vec{p}_{B2})$ on Object $B$ relative to $\vec{p}_A$.
2. Calculate displacement vectors to push $\vec{p}_A$ outside the edge while simultaneously pushing $\vec{p}_{B1}$ and $\vec{p}_{B2}$ outward.
3. Weight the displacement magnitude distributed to each node based on:
   * Relative vertex masses ($m_A$, $m_{B1}$, $m_{B2}$).
   * Proximity along the line segment: vertices closer to the orthogonal projection of $\vec{p}_A$ absorb a larger proportion of the corrective displacement.

### Velocity Impulse Resolution
Resolving kinetic momentum across three separate vertices directly is ill-posed for standard particle collision equations. The engine addresses this by collapsing the edge segment into a virtual point:

1. **Virtual Point Collapse**: Merge $\vec{p}_{B1}$ and $\vec{p}_{B2}$ into a single virtual node $\vec{p}_{virt}$ with an averaged velocity:
   $$\vec{v}_{virt} = \frac{\vec{v}_{B1} + \vec{v}_{B2}}{2}$$
2. **Elastic Impulse Calculation**: Evaluate the collision response between $\vec{p}_A$ and $\vec{p}_{virt}$ using standard 2D elastic collision equations for two colliding rigid spheres.
3. **Velocity Redistribution**: Apply the post-collision velocity derived for $\vec{p}_{virt}$ back to the edge endpoints $\vec{p}_{B1}$ and $\vec{p}_{B2}$.

---

## 4. Structural Integrity & Spring Systems

### Linear Hookean Springs
Perimeter line segments are instantiated as physical linear springs governed by Hooke's Law:

$$\vec{F}_{spring} = -k (\|\vec{p}_1 - \vec{p}_2\| - L_{rest}) \hat{u}$$

where $L_{rest}$ represents the equilibrium rest length, $k$ is the spring stiffness coefficient, and $\hat{u}$ is the normalized directional unit vector between the connected point masses. Compressing or stretching a segment generates opposing forces that push or pull the endpoints back toward $L_{rest}$.

### Internal Triangulation Trusses
Perimeter springs alone provide minimal resistance against shearing or bending. To maintain volumetric shape stability, internal diagonal springs are added in a triangulated mesh structure connecting non-adjacent perimeter vertices.

### Polygon Inversion & Stability Limits
Under high-impact collisions or severe external forces, internal vertices can cross over perimeter edges. Once a vertex pops across an opposing edge, the polygon becomes self-intersecting, invalidating the point-in-polygon collision math. Restoring spring forces can then stabilize the object in an inverted configuration or trigger extreme numerical instability ("physics explosions").

---

## 5. Advanced Shape Retention: Pressure vs. Shape Matching

To prevent inversion and preserve complex geometries, the engine employs two complementary shape-retention methodologies.

### Method A: Internal Gas Pressure
For closed objects representing hollow pressurized bodies (such as tires or balloons), the engine simulates internal gas pressure:

1. Compute the current 2D geometric area (volume) of the boundary polygon.
2. Compare the computed area against a target gas quantity to evaluate pressure differential.
3. Apply outward normal forces along each boundary line segment proportional to the internal pressure.

While effective for circular shapes, gas pressure naturally forces any polygon toward a circle, causing it to fight internal structural springs when applied to irregular geometries like a car body.

### Method B: Rigid Frame Shape Matching
For complex or asymmetric objects, shape matching forces points toward an authoring reference frame without relying on internal gas:

1. **Authoring Reference Frame**: Maintain an undeformed, rigid reference template of the object shape $S_{ref}$.
2. **Centroid Alignment**: Calculate the geometric centroid $\vec{C}$ of the active deformed point masses:
   $$\vec{C} = \frac{1}{N} \sum_{i=1}^{N} \vec{p}_i$$
   Translate $S_{ref}$ so its origin matches $\vec{C}$.
3. **Rotational Alignment**: Compute the average angular deviation $\theta_{avg}$ between current point vectors $(\vec{p}_i - \vec{C})$ and their corresponding reference vectors on $S_{ref}$. Rotate $S_{ref}$ by $\theta_{avg}$.
4. **Restoring Springs**: Connect each active point mass $\vec{p}_i$ to its corresponding node on the transformed reference frame $S_{ref}$ via a virtual spring.

Because top vertices are anchored to top reference nodes and bottom vertices to bottom reference nodes, the object cannot invert upon itself.

### Multi-Frame Subdivision & Kinematic Animation
* **Subdivision**: Broad objects subjected to non-uniform compression experience uneven spring tensions. Splitting wide objects into multiple overlapping sub-frames balances force distribution across local regions.
* **Kinematic Platforms**: Manually translating or rotating the reference frame $S_{ref}$ creates moving platforms. The shape-matching springs pull active point masses along with the frame, allowing platforms to interact realistically with surrounding physical objects.

---

## 6. Constraints, Joints & Specialized Entities

### Weld Joints
A weld joint fixes two point masses from distinct bodies to share an identical spatial position ($\vec{p}_A = \vec{p}_B$), rigidly connecting separate physical structures.

### Virtual Axle / Anchor Joints
Attaching tires to a car body without a central vertex node requires virtual anchor calculation:

1. Select a set of boundary points on the car body and compute a weighted positional average to establish a virtual car anchor $\vec{A}_{car}$.
2. Perform a similar weighted average on tire vertices to derive $\vec{A}_{wheel}$.
3. At each time step, translate participating vertices on both bodies to enforce $\vec{A}_{car} = \vec{A}_{wheel}$.

Adjusting vertex weights allows precise axle placement anywhere on the body structure.

### Distance Constraints & Particle Nodes
* **Distance Constraints**: Enforce absolute upper distance bounds between node pairs, utilized for rope physics.
* **Particle Nodes**: Assigned scalar collision radii to individual point masses, enabling thin structures like ropes to interact with polygonal shape bodies.

---

## 7. Game Systems & Emerging Gameplay

### Dynamic Shape Morphing & Environmental Triggers
* **Shape Morphing**: Interpolating reference frame geometry in real-time smoothly transforms objects during gameplay (e.g., converting staircase geometry into a smooth ramp).
* **Trigger Polygons**: Non-colliding shapes test point mass enclosure to trigger game events, adjust camera zoom levels, or modify localized gravity vector fields.
* **Raycasting**: Casting line rays through the physical world detects intersections for tripwires and grapple-hook attachment points.

### Systemic Design Outcomes
By combining foundational primitives—point masses, springs, pressure equations, shape matching frames, and constraints—the physics engine produces emergent physical behaviors. Deterministic rules interact to generate complex, unscripted mechanics, providing deep player engagement rooted in fundamental physics.

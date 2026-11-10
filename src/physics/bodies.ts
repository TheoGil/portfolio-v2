import { Body, type BodyOptions } from "./body.ts";
import { autoSegments, Shapes, type Shape, type Vec2 } from "./shapes.ts";

export interface RoundBodyOptions extends BodyOptions {
  /** Number of points on circles. Defaults to ~12px long edges. */
  segments?: number;
}

/** Factories in the spirit of Matter.Bodies. (x, y) is the centroid of the body. */
export const Bodies = {
  rectangle(x: number, y: number, width: number, height: number, options: BodyOptions = {}) {
    return new Body(Shapes.rectangle(width, height), { ...options, x, y });
  },

  circle(x: number, y: number, radius: number, options: RoundBodyOptions = {}) {
    return new Body(Shapes.circle(radius, options.segments ?? autoSegments(radius)), { ...options, x, y });
  },

  ellipse(x: number, y: number, rx: number, ry: number, options: RoundBodyOptions = {}) {
    const segments = options.segments ?? autoSegments(Math.max(rx, ry));
    return new Body(Shapes.ellipse(rx, ry, segments), { ...options, x, y });
  },

  polygon(x: number, y: number, sides: number, radius: number, options: BodyOptions = {}) {
    return new Body(Shapes.polygon(sides, radius), { ...options, x, y });
  },

  star(x: number, y: number, branches: number, outerRadius: number, innerRadius: number, options: BodyOptions = {}) {
    return new Body(Shapes.star(branches, outerRadius, innerRadius), { ...options, x, y });
  },

  /** Donut shaped body (a body with a hole). */
  ring(x: number, y: number, outerRadius: number, innerRadius: number, options: RoundBodyOptions = {}) {
    const segments = options.segments ?? autoSegments(outerRadius);
    return new Body(Shapes.ring(outerRadius, innerRadius, segments), { ...options, x, y });
  },

  /**
   * Arbitrary shape from one contour or several (holes, disjoint parts).
   * Vertices are re-centered so that their centroid lands on (x, y).
   */
  fromVertices(x: number, y: number, vertices: Vec2[] | Vec2[][], options: BodyOptions = {}) {
    return new Body(Shapes.fromVertices(vertices), { ...options, x, y });
  },

  fromShape(x: number, y: number, shape: Shape, options: BodyOptions = {}) {
    return new Body(shape, { ...options, x, y });
  },

  /** Single body made of several non overlapping parts, positioned relative to each other. */
  compound(x: number, y: number, parts: Shape[], options: BodyOptions = {}) {
    return new Body(Shapes.combine(...parts), { ...options, x, y });
  },
};

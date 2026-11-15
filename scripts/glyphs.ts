/**
 * Converts a text set in a font into point loops for the physics engine.
 * Run once, the output is committed: no font parsing at runtime.
 *
 *   node scripts/glyphs.ts <font.ttf|otf> <text> <out.json> [spacing]
 *
 * Output, in em units (font size 1, y down, baseline at y = 0):
 *   { text, capHeight, width, letters: [{ char, loops: [[x0, y0, x1, y1, ...]] }] }
 * Letters are positioned with the font advances and kerning. Contours are
 * resampled every `spacing` em (default 0.035) along their length.
 */
import { readFileSync, writeFileSync } from "node:fs";
import opentype from "opentype.js";

const { parse } = opentype;

const [fontPath, text, outPath, spacingArg] = process.argv.slice(2);
if (!fontPath || !text || !outPath) {
  console.error("Usage: node scripts/glyphs.ts <font> <text> <out.json> [spacing]");
  process.exit(1);
}
const spacing = Number(spacingArg ?? 0.035);

const file = readFileSync(fontPath);
const font = parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

type Point = [number, number];

/** Flattens a path into closed polylines, curves split in small steps. */
function flatten(commands: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]) {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let x = 0;
  let y = 0;
  const steps = 16;
  for (const c of commands) {
    if (c.type === "M") {
      if (current.length > 2) contours.push(current);
      current = [[c.x!, c.y!]];
    } else if (c.type === "L") {
      current.push([c.x!, c.y!]);
    } else if (c.type === "Q") {
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        current.push([u * u * x + 2 * u * t * c.x1! + t * t * c.x!, u * u * y + 2 * u * t * c.y1! + t * t * c.y!]);
      }
    } else if (c.type === "C") {
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        current.push([
          u * u * u * x + 3 * u * u * t * c.x1! + 3 * u * t * t * c.x2! + t * t * t * c.x!,
          u * u * u * y + 3 * u * u * t * c.y1! + 3 * u * t * t * c.y2! + t * t * t * c.y!,
        ]);
      }
    } else if (c.type === "Z") {
      if (current.length > 2) contours.push(current);
      current = [];
    }
    if (c.x !== undefined) {
      x = c.x;
      y = c.y!;
    }
  }
  if (current.length > 2) contours.push(current);
  return contours;
}

/** Points every `step` along a closed polyline. */
function resample(contour: Point[], step: number) {
  const n = contour.length;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = contour[i];
    const [bx, by] = contour[(i + 1) % n];
    const length = Math.hypot(bx - ax, by - ay);
    lengths.push(length);
    total += length;
  }
  const count = Math.max(8, Math.round(total / step));
  const out: number[] = [];
  let edge = 0;
  let edgeStart = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (edgeStart + lengths[edge] < target && edge < n - 1) edgeStart += lengths[edge++];
    const t = lengths[edge] > 0 ? (target - edgeStart) / lengths[edge] : 0;
    const [ax, ay] = contour[edge];
    const [bx, by] = contour[(edge + 1) % n];
    out.push(round(ax + (bx - ax) * t), round(ay + (by - ay) * t));
  }
  return out;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

const paths = font.getPaths(text, 0, 0, 1);
const letters = [...text].map((char, k) => ({
  char,
  loops: flatten(paths[k].commands).map((contour) => resample(contour, spacing)),
}));
const capHeight = (font.tables.os2?.sCapHeight ?? font.ascender * 0.7) / font.unitsPerEm;
const width = font.getAdvanceWidth(text, 1);

writeFileSync(outPath, JSON.stringify({ text, capHeight, width, letters }) + "\n");
const points = letters.map((l) => `${l.char}:${l.loops.map((loop) => loop.length / 2).join("+")}`).join(" ");
console.log(`${font.names.fontFamily?.en ?? fontPath} "${text}" -> ${outPath} (${points} points)`);

import type { World } from "./world.ts";

export interface RunnerOptions {
  /** Fixed simulation step, in seconds. */
  fixedDelta?: number;
  /** Max steps per frame, avoids the spiral of death on slow frames. */
  maxSteps?: number;
  /** Fill `body.rx/ry` with interpolated positions before rendering. */
  interpolate?: boolean;
  /** Called before each fixed step (input, scripted motion...). */
  onStep?: (dt: number) => void;
  /** Called once per frame after the simulation. */
  onRender?: (alpha: number, frameDelta: number) => void;
}

/**
 * Frame-rate independent loop: the world always advances by `fixedDelta`,
 * as many times as needed to catch up with real time.
 */
export class Runner {
  readonly world: World;
  fixedDelta: number;
  maxSteps: number;
  interpolate: boolean;
  /** Slow motion < 1 < fast forward. */
  timeScale = 1;
  onStep?: (dt: number) => void;
  onRender?: (alpha: number, frameDelta: number) => void;

  private accumulator = 0;
  private lastTime = -1;
  private frame = 0;
  private running = false;

  constructor(world: World, options: RunnerOptions = {}) {
    this.world = world;
    this.fixedDelta = options.fixedDelta ?? 1 / 120;
    this.maxSteps = options.maxSteps ?? 8;
    this.interpolate = options.interpolate ?? true;
    this.onStep = options.onStep;
    this.onRender = options.onRender;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = -1;
    this.frame = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }

  /** Advances the simulation to `time` (ms). Called by the loop, usable manually. */
  tick(time: number) {
    if (this.lastTime < 0) this.lastTime = time;
    // Clamp long pauses (hidden tab, breakpoint...)
    const frameDelta = Math.min((time - this.lastTime) / 1000, 0.25);
    this.lastTime = time;

    this.accumulator += frameDelta * this.timeScale;
    let steps = 0;
    while (this.accumulator >= this.fixedDelta && steps < this.maxSteps) {
      this.onStep?.(this.fixedDelta);
      this.world.step(this.fixedDelta);
      this.accumulator -= this.fixedDelta;
      steps++;
    }
    if (steps === this.maxSteps) this.accumulator %= this.fixedDelta;

    const alpha = this.accumulator / this.fixedDelta;
    if (this.interpolate) this.world.interpolate(alpha);
    this.onRender?.(alpha, frameDelta);
  }

  private loop = (time: number) => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);
    this.tick(time);
  };
}

import type { Clock } from './types';

/** Device clock plus a debug offset (Debug panel "+1h", "Clock −2h"...). */
export class SystemClock implements Clock {
  offsetMs = 0;
  now(): number {
    return Date.now() + this.offsetMs;
  }
}

/** Manually driven clock for tests. */
export class FakeClock implements Clock {
  offsetMs = 0;
  constructor(public time: number) {}
  now(): number {
    return this.time + this.offsetMs;
  }
  advance(ms: number): void {
    this.time += ms;
  }
  set(ms: number): void {
    this.time = ms;
  }
}

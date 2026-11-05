// Which worker a [+] / [−] tap on a tree or rock card moves. Pure and deterministic (list order), so it is tested.
import type { WorkerNodeId, WorkerView } from '../../engine';

/** [+]: the first unassigned worker in hire order, or null when none is free. */
export function firstFreeWorker(workers: readonly WorkerView[]): string | null {
  return workers.find((w) => w.node === null)?.id ?? null;
}

/** [−]: the last worker (in hire order) on `node`, or null when nobody is there. */
export function lastWorkerOn(workers: readonly WorkerView[], node: WorkerNodeId): string | null {
  for (let i = workers.length - 1; i >= 0; i--) if (workers[i].node === node) return workers[i].id;
  return null;
}

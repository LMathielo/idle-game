// Which worker the [+] / [−] on a tree or rock card moves: first free in hire order, last one on the node.
import { describe, expect, it } from 'vitest';
import type { WorkerView } from '../src/engine';
import { firstFreeWorker, lastWorkerOn } from '../src/components/workers/pickWorker';

const w = (id: string, node: WorkerView['node']): WorkerView => ({ id, node, nodeName: null, icon: null, status: node ? 'working' : 'unassigned' });

describe('worker pick order', () => {
  const list = [w('a', 'oak'), w('b', null), w('c', 'oak'), w('d', null)];
  it('[+] takes the first unassigned worker, or none', () => {
    expect(firstFreeWorker(list)).toBe('b');
    expect(firstFreeWorker([w('a', 'oak')])).toBeNull();
    expect(firstFreeWorker([])).toBeNull();
  });
  it('[−] takes the last worker on the node, or none', () => {
    expect(lastWorkerOn(list, 'oak')).toBe('c');
    expect(lastWorkerOn(list, 'stone')).toBeNull();
  });
});

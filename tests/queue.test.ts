import { describe, it, expect, vi } from 'vitest';
import { JobQueue } from '../src/queue.js';

describe('JobQueue', () => {
  it('runs jobs in order', async () => {
    const order: number[] = [];
    const q = new JobQueue({ baseDelayMs: 1 });
    q.push(async () => void order.push(1));
    q.push(async () => void order.push(2));
    await q.idle();
    expect(order).toEqual([1, 2]);
  });
  it('retries failing jobs then reports the final error', async () => {
    let attempts = 0;
    const onError = vi.fn();
    const q = new JobQueue({ retries: 2, baseDelayMs: 1, onError });
    q.push(async () => {
      attempts++;
      throw new Error('boom');
    });
    await q.idle();
    expect(attempts).toBe(3); // 1 tentativa + 2 retries
    expect(onError).toHaveBeenCalledOnce();
  });
  it('a failing job does not block the next one', async () => {
    const done: string[] = [];
    const q = new JobQueue({ retries: 0, baseDelayMs: 1, onError: () => {} });
    q.push(async () => {
      throw new Error('x');
    });
    q.push(async () => void done.push('ok'));
    await q.idle();
    expect(done).toEqual(['ok']);
  });
});

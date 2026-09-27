import { describe, it, expect, vi } from 'vitest';
import { sendToTarget } from '../src/senders.js';
import type { EnrichedEvent } from '../src/types.js';

const event: EnrichedEvent = {
  type: 'page.created',
  label: 'Tarefa criada',
  sourceKey: 'demandas',
  timestamp: 't',
  changes: [],
  page: { id: 'p', url: 'u', title: 'T', properties: {} },
};
const embed = { title: 'T' };

function fetchSeq(responses: Response[]): typeof fetch {
  const fn = vi.fn(async () => responses.shift()!);
  return fn as unknown as typeof fetch;
}

describe('sendToTarget', () => {
  it('posts an embed payload to discord targets', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchFn = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: init.body });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn);
    expect(calls[0]!.url).toBe('https://d/wh');
    expect(JSON.parse(calls[0]!.body)).toEqual({ embeds: [embed] });
  });
  it('posts the enriched event as JSON to webhook targets', async () => {
    const calls: string[] = [];
    const fetchFn = (async (_u: any, init: any) => {
      calls.push(init.body);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await sendToTarget({ type: 'webhook', url: 'https://n8n/wh' }, event, null, fetchFn);
    expect(JSON.parse(calls[0]!)).toMatchObject({ type: 'page.created' });
  });
  it('retries once after a 429 honoring retry_after', async () => {
    vi.useFakeTimers();
    const fetchFn = fetchSeq([
      new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 }),
      new Response(null, { status: 204 }),
    ]);
    const p = sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
  it('sends every request with an abort signal', async () => {
    let signal: unknown;
    const fetchFn = (async (_u: any, init: any) => {
      signal = init.signal;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it('caps a huge retry_after so the serial queue is not stalled', async () => {
    vi.useFakeTimers();
    const fetchFn = fetchSeq([
      new Response(JSON.stringify({ retry_after: 3600 }), { status: 429 }),
      new Response(null, { status: 204 }),
    ]);
    const p = sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
  it('retries once on 5xx', async () => {
    vi.useFakeTimers();
    const fetchFn = fetchSeq([
      new Response(null, { status: 502 }),
      new Response(null, { status: 204 }),
    ]);
    const p = sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
  it('throws on 4xx without retrying', async () => {
    const fetchFn = fetchSeq([new Response('bad', { status: 400 })]);
    await expect(
      sendToTarget({ type: 'discord', url: 'https://d/wh' }, event, embed, fetchFn),
    ).rejects.toThrow(/400/);
  });
});

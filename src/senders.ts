import type { TargetConfig } from './config.js';
import type { DiscordEmbed } from './template.js';
import type { EnrichedEvent } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The queue is serial: a target that never answers must not stall every later event.
const REQUEST_TIMEOUT_MS = 10_000;

export async function sendToTarget(
  target: TargetConfig,
  event: EnrichedEvent,
  embed: DiscordEmbed | null,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const body =
    target.type === 'discord' ? JSON.stringify({ embeds: [embed] }) : JSON.stringify(event);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchFn(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return;

    if (res.status === 429 && attempt === 0) {
      let retryAfter = 1;
      try {
        const data = (await res.json()) as { retry_after?: number };
        if (typeof data.retry_after === 'number') retryAfter = data.retry_after;
      } catch {
        // keep default
      }
      await sleep(retryAfter * 1000);
      continue;
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(500);
      continue;
    }
    throw new Error(`target responded ${res.status}`);
  }
  throw new Error('target retry exhausted');
}

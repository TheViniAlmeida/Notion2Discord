import type { TargetConfig } from './config.js';
import type { DiscordMessage } from './template.js';
import type { EnrichedEvent, PagePerson } from './types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// E-mails are only needed to resolve mentions: they never leave the service.
const noEmail = ({ name, discordId }: PagePerson): PagePerson => ({ name, email: null, discordId });

function withoutEmails(event: EnrichedEvent): EnrichedEvent {
  const people = event.page.people;
  const page = people
    ? {
        ...event.page,
        people: Object.fromEntries(
          Object.entries(people).map(([prop, list]) => [prop, list.map(noEmail)]),
        ),
      }
    : event.page;
  const comment = event.comment && {
    ...event.comment,
    author: noEmail(event.comment.author),
    mentions: event.comment.mentions.map(noEmail),
  };
  return { ...event, page, ...(comment ? { comment } : {}) };
}

// The queue is serial: a target that never answers must not stall every later event.
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_S = 30;

export async function sendToTarget(
  target: TargetConfig,
  event: EnrichedEvent,
  message: DiscordMessage | null,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const body =
    target.type === 'discord' ? JSON.stringify(message) : JSON.stringify(withoutEmails(event));

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
      await sleep(Math.min(retryAfter, MAX_RETRY_AFTER_S) * 1000);
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

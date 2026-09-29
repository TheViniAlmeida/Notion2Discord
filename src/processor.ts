import type { AppConfig } from './config.js';
import { diffProperties } from './diff.js';
import type { NotionClient } from './notion.js';
import { matchRules } from './rules.js';
import { sendToTarget } from './senders.js';
import type { SnapshotStore } from './store.js';
import { renderMessage } from './template.js';
import type { EnrichedEvent, NormalizedPage, NotionEvent, PagePerson } from './types.js';

type Logger = {
  debug: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

const noopLog: Logger = { debug: () => {}, warn: () => {}, error: () => {} };

function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

function sourceForDatabase(config: AppConfig, databaseId: string | null | undefined): string | null {
  if (!databaseId) return null;
  const wanted = normalizeId(databaseId);
  for (const [key, src] of Object.entries(config.sources)) {
    if (normalizeId(src.database_id) === wanted) return key;
  }
  return null;
}

function withDiscordId(person: PagePerson, people: Record<string, string>): PagePerson {
  return { ...person, discordId: person.email ? people[person.email] : undefined };
}

function withDiscordIds(page: NormalizedPage, people: Record<string, string>): NormalizedPage {
  if (!page.people) return page;
  const resolved = Object.fromEntries(
    Object.entries(page.people).map(([prop, list]) => [
      prop,
      list.map((p) => withDiscordId(p, people)),
    ]),
  );
  return { ...page, people: resolved };
}

export function createProcessor(deps: {
  config: AppConfig;
  store: SnapshotStore;
  notion: Pick<NotionClient, 'fetchPage' | 'fetchComment'>;
  send?: typeof sendToTarget;
  log?: Logger;
}): (raw: NotionEvent) => Promise<void> {
  const { config, store, notion } = deps;
  const send = deps.send ?? sendToTarget;
  const log = deps.log ?? noopLog;

  async function deliver(event: EnrichedEvent, eventId: string): Promise<void> {
    const rules = matchRules(config, event);
    if (rules.length === 0) {
      log.debug({ eventId, type: event.type }, 'no rule matched');
      return;
    }

    // Target errors are isolated: the snapshot is already saved, so rethrowing would make
    // the queue retry with an empty diff (lost notification + duplicates on other targets).
    for (const rule of rules) {
      for (const targetKey of rule.send_to) {
        const target = config.targets[targetKey]!;
        if (target.type === 'discord' && !rule.embed) {
          log.warn({ rule: rule.name, target: targetKey }, 'discord target without embed template, skipped');
          continue;
        }
        const message = target.type === 'discord' ? renderMessage(rule.embed!, event, rule) : null;
        try {
          await send(target, event, message);
        } catch (err) {
          log.error(
            { rule: rule.name, target: targetKey, eventId, err: (err as Error).message },
            'delivery failed, discarded',
          );
        }
      }
    }
  }

  // Comments leave page snapshots untouched: they are not property changes.
  async function processComment(raw: NotionEvent): Promise<void> {
    const pageId = raw.data?.page_id;
    // A deleted comment can no longer be fetched; skip API calls when no rule listens.
    const listened = config.rules.some((r) => r.on.includes(raw.type));
    if (raw.type === 'comment.deleted' || !pageId || !listened) {
      log.debug({ eventId: raw.id, type: raw.type }, 'comment event not processed, discarded');
      return;
    }
    const page = withDiscordIds(await notion.fetchPage(pageId), config.people);
    const sourceKey = sourceForDatabase(config, page.parentDatabaseId);
    if (!sourceKey) {
      log.debug({ eventId: raw.id, type: raw.type }, 'comment on a page outside the sources, discarded');
      return;
    }
    const comment = await notion.fetchComment(raw.entity.id);
    await deliver(
      {
        type: raw.type,
        label: config.labels[raw.type] ?? raw.type,
        sourceKey,
        page,
        changes: [],
        timestamp: raw.timestamp,
        comment: {
          text: comment.text,
          author: withDiscordId(comment.author, config.people),
          mentions: comment.mentions.map((p) => withDiscordId(p, config.people)),
        },
      },
      raw.id,
    );
  }

  return async (raw: NotionEvent) => {
    if (raw.type.startsWith('comment.')) return processComment(raw);

    const sourceKey = sourceForDatabase(config, raw.data?.parent?.id);
    if (!sourceKey) {
      log.debug({ eventId: raw.id, type: raw.type }, 'event from unknown database, discarded');
      return;
    }

    const isDeletion = raw.type === 'page.deleted';
    const prev = store.getSnapshot(raw.entity.id);
    const fetched = isDeletion ? prev : await notion.fetchPage(raw.entity.id);
    if (!fetched) {
      log.warn({ eventId: raw.id, type: raw.type }, 'deletion without snapshot, discarded');
      return;
    }

    const page = withDiscordIds(fetched, config.people);
    const changes = isDeletion ? [] : diffProperties(prev, page);
    if (!isDeletion) store.saveSnapshot(page);

    await deliver(
      {
        type: raw.type,
        label: config.labels[raw.type] ?? raw.type,
        sourceKey,
        page,
        changes,
        timestamp: raw.timestamp,
      },
      raw.id,
    );
  };
}

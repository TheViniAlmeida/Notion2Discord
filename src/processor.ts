import type { AppConfig } from './config.js';
import { diffProperties } from './diff.js';
import type { NotionClient } from './notion.js';
import { matchRules } from './rules.js';
import { sendToTarget } from './senders.js';
import type { SnapshotStore } from './store.js';
import { renderMessage } from './template.js';
import type { EnrichedEvent, NormalizedPage, NotionEvent } from './types.js';

type Logger = {
  debug: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

const noopLog: Logger = { debug: () => {}, warn: () => {}, error: () => {} };

function normalizeId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

function resolveSource(config: AppConfig, raw: NotionEvent): string | null {
  const parentId = raw.data?.parent?.id;
  if (!parentId) return null;
  const wanted = normalizeId(parentId);
  for (const [key, src] of Object.entries(config.sources)) {
    if (normalizeId(src.database_id) === wanted) return key;
  }
  return null;
}

function withDiscordIds(page: NormalizedPage, people: Record<string, string>): NormalizedPage {
  if (!page.people) return page;
  const resolved = Object.fromEntries(
    Object.entries(page.people).map(([prop, list]) => [
      prop,
      list.map((p) => ({ ...p, discordId: p.email ? people[p.email] : undefined })),
    ]),
  );
  return { ...page, people: resolved };
}

export function createProcessor(deps: {
  config: AppConfig;
  store: SnapshotStore;
  notion: Pick<NotionClient, 'fetchPage'>;
  send?: typeof sendToTarget;
  log?: Logger;
}): (raw: NotionEvent) => Promise<void> {
  const { config, store, notion } = deps;
  const send = deps.send ?? sendToTarget;
  const log = deps.log ?? noopLog;

  return async (raw: NotionEvent) => {
    const sourceKey = resolveSource(config, raw);
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

    const event: EnrichedEvent = {
      type: raw.type,
      label: config.labels[raw.type] ?? raw.type,
      sourceKey,
      page,
      changes,
      timestamp: raw.timestamp,
    };

    const rules = matchRules(config, event);
    if (rules.length === 0) {
      log.debug({ eventId: raw.id, type: raw.type }, 'no rule matched');
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
            { rule: rule.name, target: targetKey, eventId: raw.id, err: (err as Error).message },
            'delivery failed, discarded',
          );
        }
      }
    }
  };
}

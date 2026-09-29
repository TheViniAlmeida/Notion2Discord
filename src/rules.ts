import type { AppConfig, Rule, WhenCondition } from './config.js';
import type { EnrichedEvent } from './types.js';

function whenMatches(when: WhenCondition, event: EnrichedEvent): boolean {
  const change = event.changes.find((c) => c.property === when.property);
  if (when.changed_to !== undefined) {
    if (!change || change.to !== when.changed_to) return false;
  }
  if (when.changed_from !== undefined) {
    if (!change || change.from !== when.changed_from) return false;
  }
  if (when.changed === true && !change) return false;
  if (when.equals !== undefined) {
    if ((event.page.properties[when.property] ?? null) !== when.equals) return false;
  }
  return true;
}

// The event as a rule sees it: changes to its ignored properties are dropped.
export function eventForRule(rule: Rule, event: EnrichedEvent): EnrichedEvent {
  if (!rule.ignore?.length) return event;
  const ignored = new Set(rule.ignore);
  return { ...event, changes: event.changes.filter((c) => !ignored.has(c.property)) };
}

export function matchRules(config: AppConfig, event: EnrichedEvent): Rule[] {
  return config.rules.filter((rule) => {
    if (rule.source !== event.sourceKey) return false;
    if (!rule.on.includes(event.type)) return false;
    const view = eventForRule(rule, event);
    // A property update with nothing (left) to show is noise, not a notification.
    if (view.type === 'page.properties_updated' && view.changes.length === 0) return false;
    if (rule.when && !whenMatches(rule.when, view)) return false;
    return true;
  });
}

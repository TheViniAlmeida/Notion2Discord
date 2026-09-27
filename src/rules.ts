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

export function matchRules(config: AppConfig, event: EnrichedEvent): Rule[] {
  return config.rules.filter((rule) => {
    if (rule.source !== event.sourceKey) return false;
    if (!rule.on.includes(event.type)) return false;
    if (rule.when && !whenMatches(rule.when, event)) return false;
    return true;
  });
}

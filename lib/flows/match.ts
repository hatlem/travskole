/**
 * Pure trigger matching for the flow engine.
 * Type equality AND shallow strict-equal subset match of parsed filter vs event.meta.
 * No coercion ("3" ≠ 3). Empty/garbage filter => type-only match. Dedupe flowIds.
 */

export interface TriggerLike {
  flowId: number;
  eventType: string;
  filter: string; // JSON string
}

export interface EventLike {
  type: string;
  meta: Record<string, unknown>;
}

/**
 * Match an event against a list of triggers.
 * Returns unique flowIds whose triggers match the event.
 *
 * Semantics:
 * - Event type must match trigger eventType (case-sensitive, ===)
 * - Filter (if valid JSON) must be a shallow subset of event.meta using strict equality
 * - Empty or garbage filter => type-only match
 * - Duplicate flowIds are deduplicated in result
 */
export const matchTriggers = (event: EventLike, triggers: TriggerLike[]): number[] => {
  const matched = new Set<number>();

  for (const trigger of triggers) {
    // Type must match
    if (trigger.eventType !== event.type) {
      continue;
    }

    // Parse filter
    const filter = parseFilter(trigger.filter);

    // If filter is empty (garbage or empty string), type-only match passes
    if (Object.keys(filter).length === 0) {
      matched.add(trigger.flowId);
      continue;
    }

    // Check if filter is a strict-equal subset of event.meta
    if (filterMatches(filter, event.meta)) {
      matched.add(trigger.flowId);
    }
  }

  return Array.from(matched).sort((a, b) => a - b);
};

/**
 * Parse filter JSON string. Returns empty object for invalid/empty input.
 */
const parseFilter = (filterStr: string): Record<string, unknown> => {
  if (!filterStr || filterStr.trim() === '') {
    return {};
  }

  try {
    const parsed = JSON.parse(filterStr);
    // Only return if it's an object (not array, null, number, etc.)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Silently ignore parsing errors
  }

  return {};
};

/**
 * Check if filter is a strict-equal subset of meta.
 * All keys in filter must exist in meta and be strictly equal (===).
 */
const filterMatches = (filter: Record<string, unknown>, meta: Record<string, unknown>): boolean => {
  for (const key in filter) {
    if (!(key in meta)) {
      return false;
    }
    if (meta[key] !== filter[key]) {
      return false;
    }
  }
  return true;
};

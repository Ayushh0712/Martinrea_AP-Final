/**
 * Client-side registry of invoice IDs the frontend knows about.
 *
 * The backend (per project scope) exposes only GET /invoices/:id and not a
 * list endpoint. To still drive list-style pages (Dashboard, Invoice
 * Processing, Approvals queue, etc.) without resorting to fake data,
 * we maintain a localStorage-backed set of every invoice ID the frontend
 * has ever seen — additions happen on:
 *   - successful POST /invoices (create + seed)
 *   - any direct GET /invoices/:id (deep-linking)
 *
 * List pages then fan-out parallel GET /invoices/:id calls via React Query
 * and benefit from RQ's cache for free.
 */
import { readJSON, writeJSON, STORAGE_KEYS } from './storage';

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * Module-level snapshot cache. The reference is only replaced inside `save()`.
 *
 * This is REQUIRED for `useSyncExternalStore` consumers: React calls
 * `getSnapshot()` on every render and uses `Object.is` to compare against the
 * previous value. Returning a freshly-allocated array would trigger an
 * infinite render loop ("The result of getSnapshot should be cached").
 *
 * On first read we hydrate from localStorage exactly once; thereafter the
 * cache is the source of truth.
 */
let snapshot: string[] | null = null;

function load(): string[] {
  if (snapshot === null) {
    snapshot = readJSON<string[]>(STORAGE_KEYS.invoiceRegistry, []);
  }
  return snapshot;
}

function save(ids: string[]) {
  snapshot = ids;
  writeJSON(STORAGE_KEYS.invoiceRegistry, ids);
  listeners.forEach((l) => l());
}

export const invoiceRegistry = {
  /** Stable reference until the registry actually changes. Safe for useSyncExternalStore. */
  list: (): string[] => load(),

  has: (id: string): boolean => load().includes(id),

  add(id: string): void {
    const cur = load();
    if (cur.includes(id)) return;
    save([id, ...cur]);
  },

  addMany(ids: string[]): void {
    const cur = load();
    const set = new Set(cur);
    let changed = false;
    for (const id of ids) {
      if (!set.has(id)) {
        set.add(id);
        changed = true;
      }
    }
    if (changed) save(Array.from(set));
  },

  remove(id: string): void {
    const next = load().filter((x) => x !== id);
    if (next.length !== load().length) save(next);
  },

  removeMany(ids: string[]): void {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const next = load().filter((x) => !drop.has(x));
    if (next.length !== load().length) save(next);
  },

  clear(): void {
    if (load().length === 0) return;
    save([]);
  },

  /**
   * React-friendly subscribe: takes a no-arg callback (what `useSyncExternalStore`
   * passes). Returns the unsubscribe function. Stable identity across calls.
   */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

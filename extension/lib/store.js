export const ALIASES_KEY = "aliases";

// `area` is the subset of chrome.storage.StorageArea used here: get(key) and set(items).
export function createAliasStore(area) {
  let queue = Promise.resolve();

  async function read() {
    const items = await area.get(ALIASES_KEY);
    return items[ALIASES_KEY] ?? {};
  }

  // Serializes read-modify-write cycles so concurrent adds in one context never drop a record.
  function mutate(change) {
    const run = queue.then(async () => {
      const map = await read();
      const result = change(map);
      await area.set({ [ALIASES_KEY]: map });
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  async function list() {
    const map = await read();
    return Object.values(map).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return {
    list,
    async listBySite(site) {
      return (await list()).filter((r) => r.site === site);
    },
    add(record) {
      return mutate((map) => {
        map[record.email] = record;
      });
    },
    remove(email) {
      return mutate((map) => {
        delete map[email];
      });
    },
    updateNote(email, note) {
      return mutate((map) => {
        if (!map[email]) return false;
        const trimmed = note.trim();
        if (trimmed) map[email] = { ...map[email], note: trimmed };
        else {
          const { note: _drop, ...rest } = map[email];
          map[email] = rest;
        }
        return true;
      });
    },
  };
}

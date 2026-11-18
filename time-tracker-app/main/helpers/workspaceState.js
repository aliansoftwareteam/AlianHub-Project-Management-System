// CommonJS, so the repository's jest run can load it without the Electron toolchain.

const emptyState = () => ({ workspaces: [], current: null });

const cleanEntry = (entry) => ({
  url: String(entry.url),
  name: String(entry.name || ''),
  logoUrl: String(entry.logoUrl || ''),
  lastUsedAt: Number(entry.lastUsedAt) || 0,
});

const normaliseState = (raw) => {
  const workspaces = (raw && Array.isArray(raw.workspaces) ? raw.workspaces : [])
    .filter((entry) => entry && typeof entry.url === 'string' && entry.url)
    .map(cleanEntry)
    .filter((entry, i, all) => all.findIndex((other) => other.url === entry.url) === i);
  const current = raw && workspaces.some((entry) => entry.url === raw.current) ? raw.current : null;
  return { workspaces, current };
};

const touch = (state, url, now) => ({
  workspaces: state.workspaces.map((entry) => (entry.url === url ? { ...entry, lastUsedAt: now } : entry)),
  current: url,
});

const addWorkspace = (state, entry, now = Date.now()) => {
  const base = normaliseState(state);
  const existing = base.workspaces.find((w) => w.url === entry.url);
  const merged = cleanEntry({ ...existing, ...entry, name: entry.name || (existing && existing.name), logoUrl: entry.logoUrl || (existing && existing.logoUrl) });
  const workspaces = existing ? base.workspaces.map((w) => (w.url === entry.url ? merged : w)) : [...base.workspaces, merged];
  return touch({ ...base, workspaces }, entry.url, now);
};

const selectWorkspace = (state, url, now = Date.now()) => {
  const base = normaliseState(state);
  return base.workspaces.some((w) => w.url === url) ? touch(base, url, now) : base;
};

const updateWorkspace = (state, url, patch) => {
  const base = normaliseState(state);
  const workspaces = base.workspaces.map((w) => (w.url === url ? cleanEntry({ ...w, ...patch, url: w.url, lastUsedAt: w.lastUsedAt }) : w));
  return { ...base, workspaces };
};

/* The workspace in use cannot be removed: signing out of it is how a person leaves it. */
const removeWorkspace = (state, url) => {
  const base = normaliseState(state);
  if (base.current === url) return base;
  return { ...base, workspaces: base.workspaces.filter((w) => w.url !== url) };
};

/* A tracker upgraded from a build that had its server address baked in starts on that address. */
const seedWorkspace = (state, url, now = Date.now()) => {
  const base = normaliseState(state);
  if (base.workspaces.length || !url) return base;
  return addWorkspace(base, { url }, now);
};

module.exports = { emptyState, normaliseState, addWorkspace, selectWorkspace, updateWorkspace, removeWorkspace, seedWorkspace };

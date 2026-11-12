/* The agent's ticks in one order, so the form compares like with like and a save sends only what the user changed. */
export const ticksOf = (connectors) => (Array.isArray(connectors) ? connectors : [])
    .filter((entry) => entry && entry.provider && Array.isArray(entry.tools) && entry.tools.length)
    .map((entry) => ({ provider: String(entry.provider), tools: [...new Set(entry.tools.map(String))].sort() }))
    .sort((a, b) => a.provider.localeCompare(b.provider));

export const toolsTicked = (connectors, provider) => ticksOf(connectors).find((entry) => entry.provider === provider)?.tools || [];

export const isProviderTicked = (connectors, provider) => toolsTicked(connectors, provider).length > 0;

const replaced = (connectors, provider, tools) => ticksOf([...ticksOf(connectors).filter((entry) => entry.provider !== provider), { provider, tools }]);

/* Ticking an app ticks its reads, or its writes when it has no reads: a write waits for approval each time, so it
 * is ticked on purpose. Unticking an app clears all its tools. */
export const withProvider = (connectors, app, on) => {
    if (!on) return replaced(connectors, app.provider, []);
    const reads = app.tools.filter((tool) => tool.kind === "read").map((tool) => tool.key);
    return replaced(connectors, app.provider, reads.length ? reads : app.tools.map((tool) => tool.key));
};

export const withTool = (connectors, provider, key, on) => {
    const current = toolsTicked(connectors, provider);
    return replaced(connectors, provider, on ? [...current, key] : current.filter((ticked) => ticked !== key));
};

export const tickCount = (connectors) => ticksOf(connectors).reduce((n, entry) => n + entry.tools.length, 0);

/* Ticks on an app this workspace does not offer now stay on the agent, so switching the app back on restores them. */
export const notOffered = (connectors, offered) => ticksOf(connectors).filter((entry) => !(offered || []).some((app) => app.provider === entry.provider));

// Unit tests seed and change a company's budget between calls; the 60s budget cache would hide that.
// Tests that exercise the cache set AI_BUDGET_CACHE_MS themselves.
process.env.AI_BUDGET_CACHE_MS = '0';

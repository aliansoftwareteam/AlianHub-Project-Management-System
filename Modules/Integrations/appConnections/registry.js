/* A connector is { type, targets(row) -> [{ repo, projectIds, sync, legacy? }], poll({ companyId, connection, config, repo, since }) -> { events, cursor, truncated? },
 * handle(ctx, event), waiting?(config) -> reason it cannot be read yet }. An event is { key, at, kind, data }: key names it for good, at orders it. */
const connectors = { github: require('./github/connector') };

module.exports = { get: (type) => connectors[String(type)] || null, types: () => Object.keys(connectors) };

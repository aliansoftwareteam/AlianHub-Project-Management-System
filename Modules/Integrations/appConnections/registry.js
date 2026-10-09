/* A connector is { type, poll({ companyId, connection, config, since }) -> { events, cursor, truncated? },
 * handle(ctx, event), waiting?(config) -> reason it cannot be read yet }. An event is { key, at, kind, data }: key names it for good, at orders it. */
const connectors = { github: require('./github/connector') };

module.exports = { get: (type) => connectors[String(type)] || null, types: () => Object.keys(connectors) };

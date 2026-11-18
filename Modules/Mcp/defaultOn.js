const ON = ['on', 'true', '1', 'yes'];

const text = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();

/* These flags ship on (owner decision, 2026-10-09): unset means on, and only an explicit off in .env turns one off. */
const isOn = (value) => text(value) === '' || ON.includes(text(value));

const isSet = (value) => text(value) !== '';

const TOOL_FLAGS = Object.freeze(['MCP_TOOLS_DATA', 'MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK']);

const anyToolOn = (env = process.env) => TOOL_FLAGS.some((key) => isOn(env[key]));

module.exports = { ON, isOn, isSet, TOOL_FLAGS, anyToolOn };

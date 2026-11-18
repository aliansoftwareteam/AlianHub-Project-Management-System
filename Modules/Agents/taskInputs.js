// What a task carries that a skill might need: a pull request, a public page, a
// brief. The router refuses an agent whose skills need an input the task lacks,
// instead of starting a run that skips.

const { isBlockedHostname } = require('./engine/safeFetch');
const workKinds = require('./workKinds');

const inputsOf = (task = {}) => workKinds.inputsOf(task, isBlockedHostname);

module.exports = { inputsOf, MIN_BRIEF_CHARS: workKinds.MIN_BRIEF_CHARS };

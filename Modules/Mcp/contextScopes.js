const { CHAT_SCOPE } = require('../../Config/mcpOAuth');

/* Kept apart from the tools, so asking which scope a call needs loads nothing the tools read through. */
module.exports = Object.freeze({
    'person.me': 'projects:read',
    'workdays.get': 'projects:read',
    'task.fields.list': 'tasks:read',
    'proposal.get': 'tasks:read',
    'pull_request.get': 'tasks:read',
    'chat.channels.list': CHAT_SCOPE,
    'chat.messages.list': CHAT_SCOPE,
});

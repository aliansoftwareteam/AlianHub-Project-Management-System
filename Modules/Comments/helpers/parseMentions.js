// The comment editor inserts a mention as "[Display Name](userId)", and "[All](everyone)" for
// everyone. Only 24-hex ids count, so an ordinary link like "[docs](https://…)" is never one.
// An agent is "[Name](agent_<agentId>)", and a person's own connected AI is "[Name](myai_<userId>)":
// the prefix keeps both out of the person ids, so neither is ever notified or stored as a person.

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const EVERYONE = /\[[^\]]*\]\(\s*everyone\s*\)/;

const parseMentionIds = (message) => {
    if (!message || typeof message !== 'string') return [];
    const re = /\[[^\]]*\]\(([^)]*)\)/g;
    const ids = new Set();
    let match;
    while ((match = re.exec(message)) !== null) {
        const id = (match[1] || '').trim();
        if (OBJECT_ID.test(id)) ids.add(id);
    }
    return Array.from(ids);
};

const AGENT_MENTION = /\[([^\]]*)\]\(\s*agent_([0-9a-fA-F]{24})\s*\)/g;

const parseAgentMentionIds = (message) => {
    if (!message || typeof message !== 'string') return [];
    return Array.from(new Set(Array.from(message.matchAll(AGENT_MENTION), (match) => match[2])));
};

const OWN_AI_MENTION = /\[[^\]]*\]\(\s*myai_([0-9a-fA-F]{24})\s*\)/g;

const parseOwnAiMentionIds = (message) => {
    if (!message || typeof message !== 'string') return [];
    return Array.from(new Set(Array.from(message.matchAll(OWN_AI_MENTION), (match) => match[1])));
};

/* The comment as a brief: mentions read as "@Name", not as their markup. */
const mentionsAsNames = (message) => String(message || '').replace(/@?\[([^\]]*)\]\(\s*(?:agent_|myai_)?[0-9a-fA-F]{24}\s*\)/g, '@$1');

const mentionsEveryone = (message) => typeof message === 'string' && EVERYONE.test(message);

module.exports = { parseMentionIds, parseAgentMentionIds, parseOwnAiMentionIds, mentionsAsNames, mentionsEveryone };

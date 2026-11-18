export const MENTION_TYPES = Object.freeze(['user', 'doc', 'task']);
export const LINK_TYPES = Object.freeze(['doc', 'task']);
export const MENTION_SANITIZE = Object.freeze({ span: { class: 'mention', 'data-mention': true, 'data-id': true } });

const OBJECT_ID = /^[a-f\d]{24}$/i;
const QUERY_MAX = 40;
const TRIGGER = /(?:^|[\s\u00a0(])@([^@\n]*)$/;

/* The text typed since an @ that starts a word, or null when the caret is not in a mention. */
export function mentionQueryAt(textBefore) {
    const match = TRIGGER.exec(String(textBefore || ''));
    if (!match) return null;
    const query = match[1].replace(/\u00a0/g, ' ');
    if (query.length > QUERY_MAX || /^\s/.test(query)) return null;
    return query;
}

export function mentionElement({ type, id, label }) {
    const node = document.createElement('span');
    node.className = 'mention';
    node.dataset.mention = type;
    node.dataset.id = id;
    node.textContent = `@${label}`;
    return node;
}

/* `label` is the text the mention keeps in the doc; the picker shows `meta` and `name` side by side. */
export function taskMentionItem(task) {
    const key = task.TaskKey || '';
    const name = task.TaskName || '';
    return { type: 'task', id: String(task._id), label: [key, name].filter(Boolean).join(' '), meta: key, name };
}

export function mentionOf(node) {
    if (!node || !node.dataset) return null;
    const { mention: type, id } = node.dataset;
    return MENTION_TYPES.includes(type) && OBJECT_ID.test(id || '') ? { type, id } : null;
}

/* Editor.js ignores DOM changes inside [data-mutation-free], so marking a mention first keeps
 * these touches from reading as an edit; the sanitizer drops them again on save. */
export function decorateMentions(root, { labelOf = () => '' } = {}) {
    if (!root) return;
    root.querySelectorAll('span.mention[data-mention]').forEach((node) => {
        const mention = mentionOf(node);
        if (!mention) return;
        node.dataset.mutationFree = 'true';
        node.setAttribute('contenteditable', 'false');
        if (mention.type === 'user') {
            const name = labelOf(mention.id);
            if (name) node.textContent = `@${name}`;
            return;
        }
        node.setAttribute('role', 'link');
        node.setAttribute('tabindex', '0');
    });
}

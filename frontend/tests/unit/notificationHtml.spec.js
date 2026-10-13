import { describe, expect, it } from 'vitest';
import { notificationHtml } from '@/utils/notificationHtml';
import { renderNotice } from '@/views/Inbox/renderNotice';

const MARKUP = '<img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a><script>alert(3)</script>';

// Renders the way the Inbox does (v-html) and reads the result back as a document.
const asDom = (html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host;
};
const unsafeNodes = (host) => host.querySelectorAll('img, a, script, iframe, svg, style, [onerror], [onclick]');

const t = (key, params = {}) => (key === 'Inbox.oauth_client_approval' ? `${params.client} asks to act for people in this workspace.` : key);
const changeText = (msg) => msg.replace(/@\[([\w ]+?)\]\(\w{4,30}\)/g, '<b class="mentioned">@$1</b>');
const render = (it) => renderNotice(it, { t, changeText });

/* One row per notification kind whose stored message the audit found carrying user text into the HTML. */
const KINDS = [
    ['task status (bulk)', (v) => `<p><strong>Me</strong> changed status from <span style="background-color:#aaa; color:#fff;padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;">${v}</span></p>`],
    ['task priority (bulk)', (v) => `<p><strong>Me</strong> changed priority to <span>${v}</span></p>`],
    ['task attachment', (v) => `<p><strong>Me</strong> attached ${v}</p>`],
    ['task estimate', (v) => `<strong>${v}</strong> changed the estimate</strong>`],
    ['task relation', (v) => `<strong>${v}</strong> linked a task`],
    ['task delete', (v) => `<strong>${v}</strong> deleted a task`],
    ['logged hours', (v) => `<p><strong>${v}</strong> logged ${v} on ${v}</p>`],
    ['milestone', (v) => `<p><strong>Me</strong> added milestone <strong>${v}</strong> in ${v}</p>`],
    ['milestone status', (v) => `<p><strong style="padding-right: 5px;padding-left: 5px;border-radius: 5px;font-weight: 500;background-color:#123456;\n color:#fff;">${v}</strong></p>`],
    ['project create', (v) => `<p><strong>Me</strong> created project <strong>${v}</strong></p>`],
    ['project name', (v) => `<p><strong>Me</strong> renamed the project to <strong>${v}</strong></p>`],
    ['project close', (v) => `<p><strong>${v}</strong> closed the project</p>`],
    ['sprint and folder create', (v) => `<p><strong>Me</strong> created sprint <strong>${v}</strong></p>`],
    ['project status', (v) => `<p>Status <span style="font-weight: 500;background-color:#0f0; color:#fff;padding-right: 5px;padding-left: 5px;border-radius: 5px;">${v}</span></p>`],
    ['project assignee', (v) => `<p><strong>Me</strong> added <strong>${v}</strong> to <strong>${v}</strong></p>`],
    ['project type and currency', (v) => `<p><strong>Me</strong> set the type to <strong>${v}</strong></p>`],
    ['project attachment', (v) => `<p><strong>Me</strong> attached <strong>${v}</strong></p>`],
    ['estimate hours', (v) => `<p><strong>${v}</strong> estimated for <strong>${v}</strong></p>`],
    ['comment mention', (v) => `Hey @[Max Member](abcd1234) ${v}`],
    ['task reminder', (v) => v],
    ['agent run', (v) => `Agent ${v} finished task ${v}`],
    ['time off', (v) => `${v} approved your leave`],
    ['a message posted straight to the notification routes', (v) => v],
];

describe('notificationHtml', () => {
    it.each(KINDS)('renders user text in a %s notice as text, not HTML', (label, build) => {
        const host = asDom(render({ message: build(MARKUP) }));
        expect(unsafeNodes(host)).toHaveLength(0);
        expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
        expect(host.textContent).toContain('<script>alert(3)</script>');
    });

    it('keeps the markup the templates add: bold, paragraphs and the colour chips', () => {
        const host = asDom(notificationHtml('<p><strong>Me</strong> moved it to <span style="background-color: rgb(236 238 255);color: #2F3990;border-radius: 5px;padding-right: 5px;padding-left: 5px;">Done</span><b>!</b><br/></p>'));
        expect(host.querySelector('p strong').textContent).toBe('Me');
        expect(host.querySelector('span').getAttribute('style')).toBe('background-color:rgb(236 238 255);color:#2F3990;border-radius:5px;padding-right:5px;padding-left:5px');
        expect(host.querySelector('b').textContent).toBe('!');
        expect(host.querySelector('br')).not.toBeNull();
    });

    it.each([
        ['a url', '<span style="background-color:url(https://x.test/a.png)">x</span>'],
        ['a property outside the chips', '<span style="position:fixed;top:0">x</span>'],
        ['an expression', '<span style="color:expression(alert(1))">x</span>'],
        ['an event handler next to the style', '<span style="color:#fff" onmouseover="alert(1)">x</span>'],
        ['a class', '<span class="x">x</span>'],
    ])('leaves a styled tag with %s as text', (label, message) => {
        const host = asDom(notificationHtml(message));
        expect(host.querySelector('span')).toBeNull();
        expect(host.textContent).toContain('<span');
    });

    it('still marks up a mention after escaping', () => {
        const host = asDom(render({ message: 'Hey @[Max Member](abcd1234) <b onclick="x()">hi</b>' }));
        expect(host.querySelector('b.mentioned').textContent).toBe('@Max Member');
        expect(host.querySelectorAll('[onclick]')).toHaveLength(0);
    });
});

describe('an agent client approval request in the Inbox', () => {
    it('renders the client name from its data, as text', () => {
        const host = asDom(render({ changeType: 'oauth_client_approval', message: 'ignored', changeData: { clientId: 'ahc_1', clientName: `Evil ${MARKUP}` } }));
        expect(unsafeNodes(host)).toHaveLength(0);
        expect(host.textContent).toBe(`Evil ${MARKUP} asks to act for people in this workspace.`);
    });

    it('names an unnamed client generically', () => {
        expect(render({ changeType: 'oauth_client_approval', changeData: {} })).toBe('Inbox.unnamed_client asks to act for people in this workspace.');
    });
});

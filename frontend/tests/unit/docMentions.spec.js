import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import en from '@/locales/en';
import { richHtml } from '@/utils/richHtml';
import { renderNotice } from '@/views/Inbox/renderNotice';
import { mentionQueryAt, mentionElement, decorateMentions, mentionOf } from '@/components/molecules/Pages/docMentions';
import { createBlockTools } from '@/components/molecules/Pages/blockTools';

const BOB = '64b7f0c2a1b2c3d4e5f60a01';
const DOC = '64b7f0c2a1b2c3d4e5f60d01';
const TASK = '64b7f0c2a1b2c3d4e5f60b01';

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } });
const t = i18n.global.t;

describe('the @ trigger', () => {
    it.each([
        ['@', ''],
        ['Hi @', ''],
        ['Hi @bo', 'bo'],
        ['(@ann', 'ann'],
        ['Ping @Bob Sm', 'Bob Sm'],
        ['Hi\u00a0@bo', 'bo'],
    ])('opens for %j with the query %j', (before, query) => {
        expect(mentionQueryAt(before)).toBe(query);
    });

    it.each([
        ['an email address', 'mail@example'],
        ['no @ at all', 'plain text'],
        ['a query that runs on too long', `@${'x'.repeat(41)}`],
        ['a second @ inside the query', '@bob@x'],
    ])('stays shut for %s', (_label, before) => {
        expect(mentionQueryAt(before)).toBeNull();
    });
});

describe('a mention element', () => {
    it('takes its label as text, never as markup', () => {
        const node = mentionElement({ type: 'doc', id: DOC, label: '<img src=x onerror=alert(1)>Plan' });
        expect(node.querySelector('img')).toBeNull();
        expect(node.textContent).toBe('@<img src=x onerror=alert(1)>Plan');
        expect(node.outerHTML).toBe(`<span class="mention" data-mention="doc" data-id="${DOC}">@&lt;img src=x onerror=alert(1)&gt;Plan</span>`);
    });

    it('is read back only for a known type and a real id', () => {
        const host = document.createElement('div');
        host.innerHTML = `<span class="mention" data-mention="task" data-id="${TASK}">@AH-1</span><span class="mention" data-mention="project" data-id="${DOC}">x</span><span class="mention" data-mention="user" data-id="nope">y</span>`;
        const [task, project, bad] = host.querySelectorAll('span');
        expect(mentionOf(task)).toEqual({ type: 'task', id: TASK });
        expect(mentionOf(project)).toBeNull();
        expect(mentionOf(bad)).toBeNull();
    });
});

describe('decorating mentions for the reader', () => {
    const host = () => {
        const root = document.createElement('div');
        root.innerHTML = `<p>Hi <span class="mention" data-mention="user" data-id="${BOB}">@Old name</span>, see <span class="mention" data-mention="doc" data-id="${DOC}">@Plan</span> and <span class="mention" data-mention="task" data-id="${TASK}">@AH-1</span> <span class="cdx-marker">mark</span></p>`;
        return root;
    };

    it('makes doc and task mentions links, keeps people as names and marks every mention as one atom', () => {
        const root = host();
        decorateMentions(root, { labelOf: (id) => (id === BOB ? 'Bob Stone' : '') });
        const [person, doc, task] = root.querySelectorAll('.mention');
        expect(person.textContent).toBe('@Bob Stone');
        expect(person.getAttribute('role')).toBeNull();
        [doc, task].forEach((node) => {
            expect(node.getAttribute('role')).toBe('link');
            expect(node.getAttribute('tabindex')).toBe('0');
        });
        [person, doc, task].forEach((node) => {
            expect(node.getAttribute('contenteditable')).toBe('false');
            expect(node.dataset.mutationFree).toBe('true');
        });
        expect(root.querySelector('.cdx-marker').hasAttribute('contenteditable')).toBe(false);
    });

    it('leaves a person it cannot name as stored', () => {
        const root = host();
        decorateMentions(root, { labelOf: () => '' });
        expect(root.querySelector('[data-mention="user"]').textContent).toBe('@Old name');
    });
});

describe('stored doc html', () => {
    it('keeps the mention attributes and drops everything else', () => {
        const html = richHtml(`<p><span class="mention" data-mention="user" data-id="${BOB}" onclick="steal()" data-evil="1">@Bob</span></p>`);
        expect(html).toBe(`<p><span class="mention" data-mention="user" data-id="${BOB}">@Bob</span></p>`);
    });

    it('keeps the key of an uploaded image figure', () => {
        const html = richHtml('<figure class="doc-image" data-image-key="Pages/x/a.png"><figcaption>Chart</figcaption></figure>');
        expect(html).toContain('data-image-key="Pages/x/a.png"');
    });
});

describe('the Inbox line for a doc mention', () => {
    it('names the doc as text', () => {
        const html = renderNotice({
            changeType: 'doc_mention',
            message: 'Can <b>@Ann</b> check?',
            changeData: { pageId: DOC, pageTitle: '<img src=x onerror=alert(1)>Plan' },
        }, { t, changeText: (text) => text });
        const wrapper = mount({ template: '<p v-html="html"></p>', data: () => ({ html }) });
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('b').exists()).toBe(false);
        expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>Plan');
        expect(wrapper.text()).toContain('Can <b>@Ann</b> check?');
    });
});

describe('the image block', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'chart.png', { type: 'image/png' });
    const context = () => ({
        t: (key) => key,
        uploadImage: vi.fn(async () => 'Pages/p1/abc.png'),
        imageUrl: vi.fn(async () => 'https://signed.example.test/abc.png'),
        canStoreImage: vi.fn(() => true),
        projects: () => [],
        userOf: () => null,
        statusOf: () => null,
    });
    const imageTool = (ctx, data = {}) => {
        const Tool = createBlockTools(ctx).image.class;
        const tool = new Tool({ data, readOnly: false });
        document.body.appendChild(tool.render());
        return tool;
    };

    it('uploads a picked file and keeps its storage key, not a url', async () => {
        const ctx = context();
        const tool = imageTool(ctx);
        const input = tool.wrapper.querySelector('input[type="file"]');
        Object.defineProperty(input, 'files', { value: [png()] });
        input.dispatchEvent(new Event('change'));
        await flush();
        await flush();
        expect(ctx.uploadImage).toHaveBeenCalledTimes(1);
        expect(tool.save()).toEqual({ url: '', key: 'Pages/p1/abc.png', caption: '' });
        expect(tool.wrapper.querySelector('img').getAttribute('src')).toBe('https://signed.example.test/abc.png');
    });

    it('uploads an image pasted or dropped into the doc', async () => {
        const ctx = context();
        const tool = imageTool(ctx);
        tool.onPaste({ type: 'file', detail: { file: png() } });
        await flush();
        await flush();
        expect(tool.save().key).toBe('Pages/p1/abc.png');
    });

    it('refuses a file that is not an image without uploading it', async () => {
        const ctx = context();
        const tool = imageTool(ctx);
        tool.onPaste({ type: 'file', detail: { file: new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }) } });
        await flush();
        expect(ctx.uploadImage).not.toHaveBeenCalled();
        expect(tool.wrapper.textContent).toContain('Docs.image_type_refused');
    });

    it('stops at the plan storage check', async () => {
        const ctx = context();
        ctx.canStoreImage.mockReturnValue(false);
        const tool = imageTool(ctx);
        tool.onPaste({ type: 'file', detail: { file: png() } });
        await flush();
        expect(ctx.uploadImage).not.toHaveBeenCalled();
    });

    it('still takes an image by url', () => {
        const tool = imageTool(context(), { url: 'https://example.test/a.png', caption: 'A' });
        expect(tool.save()).toEqual({ url: 'https://example.test/a.png', key: '', caption: 'A' });
    });
});

describe('the mention inline tool', () => {
    it('lets Editor.js keep the canonical mention element and nothing more', () => {
        const Tool = createBlockTools({ t: (key) => key }).mention.class;
        expect(Tool.isInline).toBe(true);
        expect(Tool.sanitize).toEqual({ span: { class: 'mention', 'data-mention': true, 'data-id': true } });
    });
});

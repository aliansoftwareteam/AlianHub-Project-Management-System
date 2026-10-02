import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import TaskLinks from '@/components/molecules/TaskLinks/TaskLinks.vue';

const open = (links) => mount(TaskLinks, { props: { links } });
const rows = (wrapper) => wrapper.findAll('a').map((link) => ({ text: link.text(), href: link.attributes('href'), rel: link.attributes('rel'), target: link.attributes('target') }));

describe('the links attached to a task', () => {
    it('lists each link by its label, opening in a new tab without handing the page over', () => {
        const wrapper = open([
            { _id: 'a', url: 'https://github.com/acme/app/pull/12', kind: 'pr', label: 'Fix the login' },
            { _id: 'b', url: 'https://files.clickup.test/t1/brief.pdf', kind: 'link', label: 'brief.pdf' }
        ]);
        expect(wrapper.find('[data-test="task-links"]').text()).toContain('Projects.links');
        expect(rows(wrapper)).toEqual([
            { text: 'Fix the login', href: 'https://github.com/acme/app/pull/12', rel: 'noopener noreferrer', target: '_blank' },
            { text: 'brief.pdf', href: 'https://files.clickup.test/t1/brief.pdf', rel: 'noopener noreferrer', target: '_blank' }
        ]);
    });

    it('shows the address of a link that has no label', () => {
        expect(rows(open([{ url: 'https://example.test/spec' }]))[0].text).toBe('https://example.test/spec');
    });

    it('leaves out anything that is not an http link', () => {
        const wrapper = open([{ url: 'javascript:alert(1)', label: 'click' }, { url: '', label: 'empty' }, null, { url: 'https://example.test/ok', label: 'ok' }]);
        expect(rows(wrapper).map((row) => row.text)).toEqual(['ok']);
    });

    it('draws nothing for a task with no links', () => {
        expect(open([]).find('[data-test="task-links"]').exists()).toBe(false);
        expect(open(undefined).find('[data-test="task-links"]').exists()).toBe(false);
        expect(open([{ url: 'ftp://example.test/file' }]).find('[data-test="task-links"]').exists()).toBe(false);
    });
});

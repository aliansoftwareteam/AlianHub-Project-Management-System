import fs from 'fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import AgentMemberRow from '@/views/Ai/AgentMemberRow.vue';
import PersonMemberRow from '@/views/Ai/PersonMemberRow.vue';

const css = fs.readFileSync(path.join(__dirname, '../../src/views/Ai/parity.css'), 'utf8');
const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

const person = { id: 'u1', name: 'Anita Desai', email: 'anita.analyst.with.a.long.address@demo.test', roleType: 3, status: 'offline' };
const agent = { _id: 'a1', name: 'Daily PM', ownerId: 'u1', autonomy: 2, paused: false, skills: ['s1', 's2'] };

describe('Agents as teammates — member rows', () => {
    it('a person row keeps the email in its own truncating line with the full address in the title', () => {
        const row = mount(PersonMemberRow, { props: { person } });
        const mail = row.find('.member-row__mail');
        expect(mail.text()).toBe(person.email);
        expect(mail.attributes('title')).toBe(person.email);
        expect(row.find('.member-row__name').attributes('title')).toBe('Anita Desai');
        expect(row.find('.member-row__role').text()).toBe('Parity.role_member');
    });

    it('an agent row shows the agent name beside the AGENT tag, with the name in a title', () => {
        const row = mount(AgentMemberRow, { props: { agent, ownerName: 'Local PM' } });
        const name = row.find('.agent-id__name strong');
        expect(name.text()).toBe('Daily PM');
        expect(name.attributes('title')).toBe('Daily PM');
        expect(row.find('.agent-id__tag').text()).toBe('Parity.agent_tag');
        expect(row.find('.agent-id__sub').text()).toContain('Parity.owned_by');
    });

    it('the member column cannot be squeezed to nothing and long text truncates inside it', () => {
        expect(rule('.member-row')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
        expect(rule('.member-row__mail')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule('.member-row__name')).toMatch(/text-overflow:\s*ellipsis/);
        expect(rule('.parity-table')).toMatch(/container:\s*members\s*\/\s*inline-size/);
        expect(css).toMatch(/@container members \(max-width: \d+px\)/);
    });
});

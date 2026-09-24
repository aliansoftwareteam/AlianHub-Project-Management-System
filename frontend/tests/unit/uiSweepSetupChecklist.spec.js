import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import SetupChecklist from '@/components/molecules/Home/SetupChecklist.vue';

const words = { 'Home.step_invite': 'Invite your team', 'Home.step_permissions': 'Review member permissions', 'Home.step_permissions_note': '(defaults applied)' };

describe('SetupChecklist', () => {
    it('keeps a space between a step and its note', () => {
        const wrapper = mount(SetupChecklist, {
            props: {
                companyName: 'Acme',
                steps: [
                    { key: 'invite', label: 'Home.step_invite', cta: 'Home.invite_team', done: false },
                    { key: 'permissions', label: 'Home.step_permissions', note: 'Home.step_permissions_note', done: false },
                ],
            },
            global: { mocks: { $t: (key) => words[key] || key } },
        });
        expect(wrapper.find('.hc-setup__steps').text().replace(/\s+/g, ' ')).toContain('Review member permissions (defaults applied)');
    });
});

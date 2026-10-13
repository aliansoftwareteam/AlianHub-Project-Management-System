import { describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import PermissionMatrix from '@/components/molecules/Setting/PermissionMatrix.vue';
import en from '@/locales/en.js';
import { CHILDREN_OF, SEEDED_KEYS, seed, seededBody } from '../permissionSeed.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const store = () => createStore({
    modules: { settings: { namespaced: true, getters: { selectedCompany: () => ({ planFeature: { aiPermission: true, aiRequest: 100 } }) } } }
});
const mountMatrix = (props = {}) => mount(PermissionMatrix, {
    props: {
        advancedPermissionBody: seededBody(),
        withoutOwnerRoles: [{ key: 3, name: 'Member' }, { key: 0, name: 'Guest' }],
        changeRule: vi.fn(),
        planCondition: true,
        mode: 'advanced',
        ...props
    },
    global: { plugins: [store()], mocks: { $t: t }, stubs: { RouterLink: true } }
});

const cellNamed = (wrapper, name) => wrapper.findAll('.pm__perm').find((cell) => cell.find('.pm__perm-name').exists() && cell.find('.pm__perm-name').text() === name);
const descriptionOf = (cell) => (cell.find('.pm__perm-desc').exists() ? cell.find('.pm__perm-desc').text() : null);
const groupNamed = (wrapper, name) => wrapper.findAll('.pm__group').find((row) => row.find('.pm__group-name').text().split(' · ')[0] === name);

describe('the permission matrix explains each seeded permission', () => {
    it.each(['project_due_date', 'task_due_date', 'settings_invite_member', 'user_timesheet', 'per_user_generate_limit', 'chat_channel'])('shows the sentence under %s', (key) => {
        const cell = cellNamed(mountMatrix(), t(`SecurityAndPermission.${key}`));
        expect(descriptionOf(cell)).toBe(en.PermissionDesc[key]);
    });

    it.each(Object.keys(CHILDREN_OF))('explains the %s group in its header', (key) => {
        const header = groupNamed(mountMatrix(), t(`SecurityAndPermission.${key}`));
        expect(descriptionOf(header)).toBe(en.PermissionDesc[key]);
    });

    it('prefers the translated sentence to a description stored on the rule', () => {
        const body = seededBody().map((rule) => (rule.key === 'task_due_date' ? { ...rule, desc: 'Stored single-language text' } : rule));
        const cell = cellNamed(mountMatrix({ advancedPermissionBody: body }), t('SecurityAndPermission.task_due_date'));
        expect(descriptionOf(cell)).toBe(en.PermissionDesc.task_due_date);
    });

    it('falls back to the stored description, and otherwise shows nothing rather than a raw key', () => {
        const legacy = [
            { _id: 'legacy_stored', key: 'legacy_stored', name: 'Legacy stored', desc: 'Kept on the rule', isParent: false, parentId: 'task', roles: [] },
            { _id: 'legacy_bare', key: 'legacy_bare', name: 'Legacy bare', desc: '', isParent: false, parentId: 'task', roles: [] }
        ];
        const wrapper = mountMatrix({ advancedPermissionBody: [...seededBody(), ...legacy] });
        expect(descriptionOf(cellNamed(wrapper, 'Legacy stored'))).toBe('Kept on the rule');
        expect(descriptionOf(cellNamed(wrapper, 'Legacy bare'))).toBeNull();
        expect(wrapper.html()).not.toContain('PermissionDesc.');
    });

    it('finds a permission by the words of the description it shows', () => {
        const names = mountMatrix({ searchValue: 'deadline' }).findAll('.pm__perm-name').map((name) => name.text());
        expect(names).toEqual([t('SecurityAndPermission.project_due_date'), t('SecurityAndPermission.task_due_date')]);
    });
});

describe('PermissionDesc matches the seeded permission catalogue', () => {
    it('reads the whole catalogue', () => {
        expect(seed.rules.map((rule) => rule.key)).toEqual(Object.keys(CHILDREN_OF));
        expect(seededBody()).toHaveLength(SEEDED_KEYS.length);
    });

    it('has no sentence for a permission that does not exist', () => {
        expect(Object.keys(en.PermissionDesc).filter((key) => !SEEDED_KEYS.includes(key))).toEqual([]);
    });

    it('has a sentence for every seeded permission', () => {
        expect(SEEDED_KEYS.filter((key) => !(key in en.PermissionDesc))).toEqual([]);
    });
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';
import { createStore } from 'vuex';

vi.mock('@/components/organisms/Shell/ShellIcon.vue', () => ({ default: { name: 'ShellIcon', render: () => null } }));

import PermissionMatrix from '@/components/molecules/Setting/PermissionMatrix.vue';
import en from '@/locales/en.js';
import { seededBody } from '../permissionSeed.js';

const i18n = config.global.plugins[0];
i18n.global.setLocaleMessage('en', en);
const t = i18n.global.t;

const ROLES = [{ key: 3, name: 'Member' }, { key: 0, name: 'Guest' }];
const store = () => createStore({
    modules: { settings: { namespaced: true, getters: { selectedCompany: () => ({ planFeature: { aiPermission: true, aiRequest: 100 } }) } } }
});
const mountMatrix = (props = {}) => mount(PermissionMatrix, {
    props: { advancedPermissionBody: seededBody(), withoutOwnerRoles: ROLES, changeRule: vi.fn(), planCondition: true, mode: 'advanced', ...props },
    global: { plugins: [store()], mocks: { $t: t }, stubs: { RouterLink: true } }
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.resolve(HERE, '../../src/components/molecules/Setting/PermissionMatrix.vue'), 'utf8').split('<style scoped>')[1];
const ruleBody = (source, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(source);
    return match ? match[2] : '';
};

describe('the permission matrix on a narrow screen', () => {
    it('scrolls its role columns inside the card, not the page', () => {
        const wrapper = mountMatrix();
        const table = wrapper.find('.pm > .pm__scroll > .pm__table[role="table"]');
        expect(table.exists()).toBe(true);
        expect(wrapper.findAll('[role="row"]').length).toBe(table.findAll('[role="row"]').length);
        expect(ruleBody(css, '.pm__scroll')).toMatch(/overflow-x:\s*auto/);
    });

    it('gives the table a minimum width that keeps the permission column readable and grows with each role', () => {
        expect(mountMatrix().find('.pm__table').attributes('style')).toMatch(/--pm-role-cols:\s*4\b/);
        const three = mountMatrix({ withoutOwnerRoles: [...ROLES, { key: 7, name: 'Contractor' }] });
        expect(three.find('.pm__table').attributes('style')).toMatch(/--pm-role-cols:\s*5\b/);
        expect(ruleBody(css, '.pm__table')).toMatch(/min-width:\s*calc\(var\(--pm-perm-min\)\s*\+\s*var\(--pm-role-cols\)/);
        expect(ruleBody(css, '.pm')).toMatch(/--pm-perm-min:\s*\d+px/);
    });

    it('keeps the permission column pinned on the left, on an opaque background', () => {
        const wrapper = mountMatrix();
        wrapper.findAll('[role="row"]').forEach((row) => expect(row.element.firstElementChild.classList.contains('pm__perm')).toBe(true));
        const perm = ruleBody(css, '.pm__perm');
        expect(perm).toMatch(/position:\s*sticky/);
        expect(perm).toMatch(/left:\s*0/);
        expect(perm).toMatch(/background:[^;]*var\(--surface\)/);
        expect(ruleBody(css, '.pm__group .pm__perm')).toMatch(/background:\s*var\(--surface-2\)/);
    });

    it('narrows the permission column on a phone rather than hiding it', () => {
        const phone = css.split('@media (max-width: 767px)').slice(1).join('\n');
        expect(ruleBody(phone, '.pm')).toMatch(/--pm-perm-min:\s*\d+px/);
    });
});

describe('every control in the matrix names its permission and role', () => {
    const controls = (row) => row.findAll('button[role="switch"], select, input');
    const nameOf = (row) => (row.find('.pm__perm-name').exists() ? row.find('.pm__perm-name') : row.find('.pm__group-name')).text().split(' · ')[0];

    it.each(['advanced', 'simple'])('in %s mode', (mode) => {
        const wrapper = mountMatrix({ mode, simpleKeys: ['task_due_date', 'task_create', 'settings_invite_member', 'per_user_generate_limit'] });
        const headers = wrapper.findAll('[role="columnheader"]').map((header) => header.text());
        let checked = 0;
        wrapper.findAll('[role="row"]').slice(1).forEach((row) => {
            const cells = [...row.element.children];
            controls(row).forEach((control) => {
                const column = cells.findIndex((cell) => cell.contains(control.element));
                const label = control.attributes('aria-label') || '';
                expect(label).toContain(nameOf(row));
                expect(label).toContain(headers[column]);
                checked += 1;
            });
        });
        expect(checked).toBeGreaterThan(ROLES.length * 4);
    });
});

/* Task 046 M3, slice G3: the people on the Goals page, with the real `@/composable`. Its getUser
   answers "Ghost User" for an id it does not know and a removed member's e-mail in place of their
   name; a spec that mocks it shows neither. No project is selected on this page, so nothing here
   may lean on checkApps or an injected project. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config, mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { defineComponent } from 'vue';
import fixture from '../fixtures/goalResponses.json';
import en from '@/locales/en';

vi.mock('@/services', () => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn(), apiRequestWithoutSecure: vi.fn() }));

// The store and the composable import each other; the app loads the store first, and so must this.
import '@/store';
import GoalRow from '@/views/Goals/GoalRow.vue';
import { useGoalPeople } from '@/views/Goals/useGoalPeople';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/views/Goals');
const ME = '6f0000000000000000000001';
const SAM = '6f0000000000000000000002';
const ADA = '6f0000000000000000000003';
const GIL = '6f0000000000000000000004';
const GONE = '6f0000000000000000000005';
const INVITED = '6f0000000000000000000006';

const USERS = [
    { _id: ME, Employee_Name: 'Me Myself', Employee_profileImageURL: 'https://files.test/me.png' },
    { _id: SAM, Employee_Name: 'Sam Carter' },
    { _id: ADA, Employee_Name: 'Ada Admin' },
    { _id: GIL, Employee_Name: 'Gil Guest' },
    { _id: INVITED, Employee_Name: 'Ivy Invited' }
];
const SEATS = [
    { _id: 's1', userId: ME, roleType: 3, status: 2, designation: '' },
    { _id: 's2', userId: SAM, roleType: 3, status: 2, designation: '' },
    { _id: 's3', userId: ADA, roleType: 2, status: 2, designation: '' },
    { _id: 's4', userId: GIL, roleType: 0, status: 2, designation: '' },
    { _id: 's5', userId: GONE, roleType: 3, status: 2, isDelete: true, designation: '', userEmail: 'gone@example.com' },
    { _id: 's6', userId: INVITED, roleType: 3, status: 1, designation: '' }
];

const newStore = (roleType = 3) => createStore({
    getters: {
        'users/users': () => USERS,
        'settings/companyUsers': () => SEATS,
        'settings/companyOwnerDetail': () => ({ userId: ADA }),
        'settings/companyUserDetail': () => ({ roleType })
    }
});
const provide = { $defaultUserAvatar: '/img/person.png', $defaultGhostCustomUserImg: '/img/ghost.png' };
const people = (roleType) => mount(defineComponent({ setup: () => useGoalPeople(), render: () => null }), { global: { plugins: [newStore(roleType)], provide } }).vm;
const row = (goal) => mount(GoalRow, { props: { goal }, global: { plugins: [newStore()], provide } });
const [churn, , hiring] = fixture.list.response.data;

beforeEach(() => {
    config.global.plugins[0].global.setLocaleMessage('en', en);
    config.global.mocks.$t = config.global.plugins[0].global.t;
});

describe('who a goal can be shared with or handed to', () => {
    it('is the members with a live seat, by name, with guests marked', () => {
        expect(people().members.map((person) => [person.name, person.guest])).toEqual([['Ada Admin', false], ['Gil Guest', true], ['Me Myself', false], ['Sam Carter', false]]);
    });

    it('carries a picture when the person has one', () => {
        expect(people().members.find((person) => person.id === ME)).toMatchObject({ image: 'https://files.test/me.png', initial: 'M' });
    });
});

describe('a person the page has to name', () => {
    it('is named from the workspace\'s people', () => {
        expect(people().personOf(SAM)).toMatchObject({ id: SAM, name: 'Sam Carter', initial: 'S' });
    });

    it('still has a name when they have left, or were never known here', () => {
        expect(people().personOf(GONE).name).toBe('gone@example.com');
        expect(people().personOf('6f00000000000000000000ff').name).toBe('Ghost User');
        expect(people().personOf('')).toMatchObject({ id: '', name: 'Someone' });
    });
});

describe('what the person looking may do', () => {
    it('is read from their own seat', () => {
        expect([people(0), people(3), people(2), people(1)].map((vm) => [vm.isGuest, vm.isPrivileged])).toEqual([[true, false], [false, false], [false, true], [false, true]]);
    });
});

describe('a goal in the list', () => {
    it('names its owner from the real directory', () => {
        expect(row(churn).find('[data-test="gls-owner"]').attributes('title')).toBe('Owned by Me Myself');
        expect(row(churn).find('[data-test="gls-owner"] img').attributes('src')).toBe('https://files.test/me.png');
        expect(row(hiring).find('[data-test="gls-owner"]').attributes('title')).toBe('Owned by Sam Carter');
    });

    it('still renders when its owner has left the workspace', () => {
        const orphan = row({ ...churn, ownerUserId: GONE });
        expect(orphan.find('.gls__name').text()).toBe('Cut churn');
        expect(orphan.find('[data-test="gls-owner"]').attributes('title')).toBe('Owned by gone@example.com');
    });
});

describe('the inject trap', () => {
    it('is not something the page relies on: nothing under views/Goals calls checkApps or injects a selected project', () => {
        const offenders = fs.readdirSync(SRC)
            .filter((file) => /\.(vue|js)$/.test(file))
            .filter((file) => /checkApps|selectedProject/.test(fs.readFileSync(path.join(SRC, file), 'utf8')));
        expect(offenders).toEqual([]);
    });
});

import { describe, expect, it } from 'vitest';
import { peopleCarried } from '@/utils/duplicatePeople';

const ROLE_OWNER = 1;
const ROLE_MEMBER = 3;

const seats = [
    { userId: 'u1', roleType: ROLE_OWNER },
    { userId: 'u2', roleType: ROLE_MEMBER },
    { userId: 'u3', roleType: ROLE_MEMBER },
    { userId: 'u4', roleType: ROLE_MEMBER, isDelete: true },
    { userId: 'u5', roleType: ROLE_MEMBER, status: 3 },
];

describe('peopleCarried', () => {
    it('brings along everybody who can open an open project', () => {
        const ids = peopleCarried(['u1', 'u2', 'u3'], { project: {}, seats });
        expect(ids).toEqual(['u1', 'u2', 'u3']);
    });

    it('drops people whose seat was removed or cancelled', () => {
        expect(peopleCarried(['u2', 'u4', 'u5'], { project: {}, seats })).toEqual(['u2']);
    });

    it('drops people who have no seat in the workspace at all', () => {
        expect(peopleCarried(['stranger', 'u2'], { project: {}, seats })).toEqual(['u2']);
    });

    it('keeps only the project members of a private project, plus owners', () => {
        const project = { isPrivateSpace: true, AssigneeUserId: ['u2'] };
        expect(peopleCarried(['u1', 'u2', 'u3'], { project, seats })).toEqual(['u1', 'u2']);
    });

    it('counts a person who belongs to a team on a private project', () => {
        const project = { isPrivateSpace: true, AssigneeUserId: ['tId_t1'] };
        const teams = [{ _id: 't1', assigneeUsersArray: ['u3'] }];
        expect(peopleCarried(['u2', 'u3'], { project, seats, teams })).toEqual(['u3']);
    });

    it('offers only the owner of a personal project', () => {
        const project = { isPersonal: true, personalOwner: 'u2' };
        expect(peopleCarried(['u1', 'u2', 'u3'], { project, seats })).toEqual(['u2']);
    });

    it('narrows a private list to the people on that list', () => {
        const sprint = { private: true, AssigneeUserId: ['u3'] };
        expect(peopleCarried(['u1', 'u2', 'u3'], { project: {}, sprint, seats })).toEqual(['u3']);
    });

    it('does not narrow a list that is not private', () => {
        const sprint = { private: false, AssigneeUserId: ['u3'] };
        expect(peopleCarried(['u2', 'u3'], { project: {}, sprint, seats })).toEqual(['u2', 'u3']);
    });

    it('carries nobody from a private list that has no people on it', () => {
        expect(peopleCarried(['u2'], { project: {}, sprint: { private: true }, seats })).toEqual([]);
    });

    it('reads numeric ids as the text the server compares', () => {
        const numbered = [{ userId: 7, roleType: ROLE_MEMBER }];
        expect(peopleCarried([7], { project: {}, seats: numbered })).toEqual(['7']);
    });

    it('answers nothing for no people', () => {
        expect(peopleCarried([], { project: {}, seats })).toEqual([]);
        expect(peopleCarried(undefined, { project: {}, seats })).toEqual([]);
        expect(peopleCarried(null, { project: {}, seats })).toEqual([]);
    });
});

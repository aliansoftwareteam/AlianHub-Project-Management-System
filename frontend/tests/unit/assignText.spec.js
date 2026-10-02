import { describe, expect, it } from 'vitest';
import { assignPeopleText, assignSkippedText } from '@/views/Automations/assignText';

const t = (key, params) => (params ? `${key}(${Object.values(params).join('|')})` : key);

describe('assignPeopleText', () => {
    it('lists names, and for a role with no name uses the role\'s words', () => {
        expect(assignPeopleText([{ name: 'Asha' }, { userId: 'task_creator' }, { userId: 'task_watchers' }], t)).toBe('Asha, Automations.assign_task_creator, Automations.notify_role_task_watchers');
    });

    it('a person with no name and no known role is "unknown person"', () => {
        expect(assignPeopleText([{ userId: 'u9' }], t)).toBe('Automations.assign_unknown_person');
    });

    it('nobody gives an empty line', () => {
        expect(assignPeopleText([], t)).toBe('');
        expect(assignPeopleText(undefined, t)).toBe('');
    });
});

describe('assignSkippedText', () => {
    it('says who was skipped and why', () => {
        expect(assignSkippedText([{ name: 'Asha', reason: 'on_leave' }, { userId: 'form_submitter', reason: 'not_in_project' }], t))
            .toBe('Automations.assign_skipped(Asha (Automations.assign_skip_on_leave), Automations.assign_form_submitter (Automations.assign_skip_not_in_project))');
    });

    it('an empty list still gives the sentence, with no people', () => {
        expect(assignSkippedText(undefined, t)).toBe('Automations.assign_skipped()');
    });
});

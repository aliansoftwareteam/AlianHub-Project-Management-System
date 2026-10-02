import { describe, expect, it } from 'vitest';
import { triggerLabel, actionLabel, fieldLabel, triggerHelpKey, actionHelpKey } from '@/views/Automations/registryText';

const t = (key, params) => (params ? `${key}(${Object.values(params).join('|')})` : key);

describe('registry labels', () => {
    it('a trigger with words of its own is shown in the reader\'s language', () => {
        expect(triggerLabel({ key: 'task.due_date_passed', label: 'Due date passed' }, t)).toBe('Automations.trigger_due_date_passed');
        expect(actionLabel({ key: 'notify', label: 'Notify' }, t)).toBe('Automations.action_notify');
    });

    it('one without keeps the label the registry gave it', () => {
        expect(triggerLabel({ key: 'task.created', label: 'Task created' }, t)).toBe('Task created');
        expect(actionLabel({ key: 'set_status', label: 'Set status' }, t)).toBe('Set status');
    });

    it('a missing entry or a missing label gives an empty label', () => {
        expect(triggerLabel(undefined, t)).toBe('');
        expect(actionLabel(null, t)).toBe('');
        expect(triggerLabel({ key: 'x' }, t)).toBe('');
    });

    it('help text exists only for the entries that have it', () => {
        expect(triggerHelpKey('task.subtasks_all_done')).toBe('Automations.trigger_subtasks_all_done_help');
        expect(actionHelpKey('notify')).toBe('Automations.action_notify_help');
        expect(triggerHelpKey('task.created')).toBe('');
        expect(actionHelpKey('unknown')).toBe('');
        expect(triggerHelpKey(undefined)).toBe('');
    });
});

describe('fieldLabel', () => {
    it('a field the builder draws itself is named as the builder names it', () => {
        expect(fieldLabel('notify', 'message', {}, t)).toBe('Automations.notify_message');
        expect(fieldLabel('assign', 'userIds', {}, t)).toBe('Automations.assign_people');
    });

    it('other fields use the label in the action\'s schema', () => {
        expect(fieldLabel('set_status', 'status', { status: { label: 'New status' } }, t)).toBe('New status');
    });

    it('with no schema or no label the field name itself is shown', () => {
        expect(fieldLabel('set_status', 'status', undefined, t)).toBe('status');
        expect(fieldLabel('set_status', 'status', { status: {} }, t)).toBe('status');
        expect(fieldLabel('set_status', 'status', { other: { label: 'x' } }, t)).toBe('status');
    });

    it('the same field name under a different action is not mistaken for it', () => {
        expect(fieldLabel('set_status', 'message', {}, t)).toBe('message');
    });
});

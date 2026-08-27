'use strict';

const AUTOFILL_ACTIONS = ['preview', 'apply'];
const NATIVE_ASSIGNEE_ID = 'assignee';
const SUMMARY_TYPES = new Set(['text', 'textarea']);
const DATE_TYPES = new Set(['date']);
const TAG_TYPES = new Set(['dropdown']);
const OWNER_TITLE = /\b(owner|assignee|people|person|lead)\b/i;
const ISO_DATE = /\b(20\d{2}-\d{2}-\d{2})\b/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const TITLE_CAP = 400;
const TEXT_CAP = 2400;
const SUMMARY_VALUE_CAP = 2000;
const COMMENT_CAP = 12;
const PAGE_CAP = 4;

function recordId(row) {
    if (row == null) return '';
    if (typeof row === 'string' || typeof row === 'number') return String(row).trim();
    return String(row._id || row.id || '').trim();
}

function clamp(value, cap) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length <= cap ? trimmed : `${trimmed.slice(0, cap)}…`;
}

function stripHtml(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

function isWritablePermission(permission) {
    return permission === true || permission === 1 || permission === 2;
}

function isAiAction(action) {
    return AUTOFILL_ACTIONS.includes(String(action || '').toLowerCase());
}

function kindForField(field) {
    const type = String((field && field.fieldType) || '').toLowerCase();
    if (SUMMARY_TYPES.has(type)) return 'summary';
    if (DATE_TYPES.has(type)) return 'date';
    if (TAG_TYPES.has(type)) {
        return OWNER_TITLE.test(String((field && field.fieldTitle) || '')) ? 'owner' : 'tag';
    }
    return null;
}

function customFieldEntry(task, fieldId) {
    const bag = task && task.customField && typeof task.customField === 'object' ? task.customField : null;
    if (!bag || !fieldId) return null;
    return bag[fieldId] || bag[String(fieldId)] || null;
}

function isEmptyValue(value) {
    if (value == null) return true;
    if (Array.isArray(value)) return value.filter((item) => item !== '' && item != null).length === 0;
    if (typeof value === 'string') return !value.trim();
    if (value instanceof Date) return Number.isNaN(value.getTime());
    return false;
}

function isCustomFieldEmpty(task, field) {
    const id = recordId(field);
    const entry = customFieldEntry(task, id);
    return isEmptyValue(entry && Object.prototype.hasOwnProperty.call(entry, 'fieldValue') ? entry.fieldValue : undefined);
}

function isAssigneeEmpty(task) {
    const ids = task && Array.isArray(task.AssigneeUserId) ? task.AssigneeUserId : [];
    return ids.map(recordId).filter(Boolean).length === 0;
}

function fieldAppliesToTask(field, task) {
    if (!field || String(field.type || 'task') !== 'task') return false;
    if (field.isDelete === false) return false;
    if (field.global) return true;
    const projectId = String((task && task.ProjectID) || '');
    const ids = Array.isArray(field.projectId) ? field.projectId : [];
    return ids.map(String).includes(projectId);
}

function fieldHiddenFromCaller(field, { uid, roleType } = {}) {
    const hide = Array.isArray(field && field.fieldHide) ? field.fieldHide : [];
    if (!hide.length) return false;
    const marks = hide.map(String);
    return marks.includes(String(uid || '')) || (roleType != null && marks.includes(String(roleType)));
}

function normalizePeople(people) {
    const out = [];
    const seen = new Set();
    for (const row of people || []) {
        const id = recordId(row);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            name: String((row && (row.name || row.Employee_Name)) || '').trim(),
            email: String((row && (row.email || row.Employee_Email || row.userEmail)) || '').trim().toLowerCase(),
        });
    }
    return out;
}

function normalizeOptions(options) {
    const out = [];
    for (const row of options || []) {
        const id = recordId(row);
        if (!id) continue;
        out.push({
            id,
            label: String((row && (row.label || row.value || row.name)) || '').trim(),
        });
    }
    return out;
}

function matchPerson(value, people) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    return (people || []).find((person) => (
        person.id === raw
        || (person.name && person.name.toLowerCase() === lower)
        || (person.email && person.email === lower)
    )) || null;
}

function matchOption(value, options) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    return (options || []).find((option) => (
        option.id === raw
        || (option.label && option.label.toLowerCase() === lower)
    )) || null;
}

function permissionGate(permissions) {
    const customField = isWritablePermission(permissions && permissions.customField);
    const assignee = isWritablePermission(permissions && permissions.assignee);
    if (!customField && !assignee) {
        return { allowed: false, reason: 'You do not have permission to set these fields.' };
    }
    return { allowed: true, customField, assignee };
}

function listEmptyTargets({ task, fields, people, permissions }) {
    const gate = permissionGate(permissions);
    const targets = [];
    if (!gate.allowed) return targets;
    const allowedPeople = normalizePeople(people);

    if (gate.customField) {
        for (const field of fields || []) {
            if (!fieldAppliesToTask(field, task)) continue;
            if (fieldHiddenFromCaller(field, permissions)) continue;
            const kind = kindForField(field);
            if (!kind) continue;
            if (!isCustomFieldEmpty(task, field)) continue;
            const target = {
                fieldId: recordId(field),
                kind,
                fieldType: String(field.fieldType || ''),
                title: String(field.fieldTitle || '').trim() || 'Untitled field',
            };
            if (kind === 'tag' || kind === 'owner') {
                target.options = normalizeOptions(field.fieldOptions);
            }
            if (Array.isArray(field.fieldPastFuture)) target.fieldPastFuture = field.fieldPastFuture;
            targets.push(target);
        }
    }

    if (gate.assignee && isAssigneeEmpty(task)) {
        targets.push({
            fieldId: NATIVE_ASSIGNEE_ID,
            kind: 'owner',
            source: 'native',
            title: 'Assignee',
            people: allowedPeople,
        });
    }

    return targets;
}

function parseDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    const raw = String(value || '').trim();
    const iso = raw.match(ISO_DATE);
    const stamp = iso ? iso[1] : '';
    if (!stamp) return null;
    const [year, month, day] = stamp.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
}

function dateAllowed(date, fieldPastFuture) {
    const flags = Array.isArray(fieldPastFuture) ? fieldPastFuture.map(String) : [];
    if (!flags.length) return true;
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const valueUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const allowFuture = flags.includes('Future');
    const allowPast = flags.includes('Past');
    if (allowFuture && !allowPast && valueUtc < todayUtc) return false;
    if (allowPast && !allowFuture && valueUtc > todayUtc) return false;
    return true;
}

function descriptionText(task) {
    const block = task && task.descriptionBlock;
    const blocks = Array.isArray(block) ? block : (block && Array.isArray(block.blocks) ? block.blocks : []);
    if (blocks.length) {
        const bits = blocks.map((item) => {
            const data = item && item.data;
            if (!data) return '';
            if (typeof data.text === 'string') return data.text;
            if (typeof data.message === 'string') return data.message;
            if (Array.isArray(data.items)) {
                return data.items.map((row) => (typeof row === 'string' ? row : (row && (row.content || row.text)) || '')).join(' ');
            }
            return '';
        }).join(' ');
        const fromBlocks = stripHtml(bits);
        if (fromBlocks) return clamp(fromBlocks, TEXT_CAP);
    }
    return clamp(stripHtml(task && task.description), TEXT_CAP);
}

function commentTexts(comments) {
    return (comments || []).slice(0, COMMENT_CAP).map((row) => ({
        id: recordId(row),
        message: clamp(stripHtml(row && (row.message || row.text)), 400),
    })).filter((row) => row.message);
}

function pageTexts(pages) {
    return (pages || []).slice(0, PAGE_CAP).map((row) => ({
        id: recordId(row),
        title: clamp(String((row && row.title) || ''), 120),
        text: clamp(stripHtml(row && (row.rawText || row.text)), 400),
    })).filter((row) => row.id);
}

function suggestionHaystack({ title, description, comments, pages }) {
    const commentsText = (comments || []).map((row) => row.message || stripHtml(row)).join(' ');
    const pagesText = (pages || []).map((row) => `${row.title || ''} ${row.text || ''}`).join(' ');
    return `${title || ''} ${description || ''} ${commentsText} ${pagesText}`.toLowerCase();
}

function heuristicSuggestions({ targets, people, title, description, comments, pages }) {
    const haystack = suggestionHaystack({ title, description, comments, pages });
    const allowedPeople = normalizePeople(people);
    const suggestions = [];
    for (const target of targets || []) {
        if (target.kind === 'summary') {
            const value = clamp(description || title, SUMMARY_VALUE_CAP);
            if (value) suggestions.push({ fieldId: target.fieldId, kind: 'summary', value });
            continue;
        }
        if (target.kind === 'date') {
            const match = `${description || ''} ${title || ''} ${haystack}`.match(ISO_DATE);
            if (match) suggestions.push({ fieldId: target.fieldId, kind: 'date', value: match[1] });
            continue;
        }
        if (target.kind === 'tag') {
            const option = (target.options || []).find((row) => row.label && haystack.includes(row.label.toLowerCase()));
            if (option) suggestions.push({ fieldId: target.fieldId, kind: 'tag', optionId: option.id, value: option.label });
            continue;
        }
        if (target.kind === 'owner') {
            const mentioned = allowedPeople.find((person) => person.name && haystack.includes(person.name.toLowerCase()));
            if (target.source === 'native') {
                if (mentioned) suggestions.push({ fieldId: target.fieldId, kind: 'owner', personId: mentioned.id, value: mentioned.name });
                continue;
            }
            const option = (target.options || []).find((row) => {
                if (!row.label) return false;
                const label = row.label.toLowerCase();
                if (haystack.includes(label)) return true;
                return Boolean(mentioned && mentioned.name && mentioned.name.toLowerCase() === label);
            });
            if (option) suggestions.push({ fieldId: target.fieldId, kind: 'owner', optionId: option.id, value: option.label });
        }
    }
    return suggestions;
}

function skipReasonWhenMissingTarget(fieldId, task) {
    if (!fieldId) return 'unknown';
    if (fieldId === NATIVE_ASSIGNEE_ID) return isAssigneeEmpty(task) ? 'unknown' : 'filled';
    return isCustomFieldEmpty(task, { _id: fieldId }) ? 'unknown' : 'filled';
}

function sanitizeSuggestions(suggestions, { targets, people, task } = {}) {
    const byId = new Map((targets || []).map((target) => [target.fieldId, target]));
    const allowedPeople = normalizePeople(people);
    const out = [];
    const skipped = [];
    for (const raw of suggestions || []) {
        if (!raw || typeof raw !== 'object') continue;
        const fieldId = recordId(raw.fieldId || raw.id);
        const target = byId.get(fieldId);
        if (!target) {
            skipped.push({ fieldId, reason: skipReasonWhenMissingTarget(fieldId, task) });
            continue;
        }
        if (target.source === 'native') {
            if (!isAssigneeEmpty(task)) {
                skipped.push({ fieldId, reason: 'filled' });
                continue;
            }
        } else if (!isCustomFieldEmpty(task, { _id: fieldId })) {
            skipped.push({ fieldId, reason: 'filled' });
            continue;
        }

        if (target.kind === 'summary') {
            const value = clamp(String(raw.value == null ? '' : raw.value), SUMMARY_VALUE_CAP);
            if (!value) {
                skipped.push({ fieldId, reason: 'empty' });
                continue;
            }
            out.push({ fieldId, kind: 'summary', title: target.title, value, display: value });
            continue;
        }

        if (target.kind === 'date') {
            const date = parseDateValue(raw.value || raw.date);
            if (!date) {
                skipped.push({ fieldId, reason: 'invalid-date' });
                continue;
            }
            if (!dateAllowed(date, target.fieldPastFuture)) {
                skipped.push({ fieldId, reason: 'date-constraint' });
                continue;
            }
            const iso = date.toISOString().slice(0, 10);
            out.push({ fieldId, kind: 'date', title: target.title, value: iso, display: iso });
            continue;
        }

        if (target.kind === 'tag') {
            const option = matchOption(raw.optionId || raw.value || raw.label, target.options || []);
            if (!option) {
                skipped.push({ fieldId, reason: 'invented-tag' });
                continue;
            }
            out.push({
                fieldId,
                kind: 'tag',
                title: target.title,
                value: [option.id],
                optionId: option.id,
                display: option.label || option.id,
            });
            continue;
        }

        if (target.kind === 'owner') {
            if (target.source === 'native') {
                const person = matchPerson(raw.personId || raw.value || raw.name, allowedPeople);
                if (!person) {
                    skipped.push({ fieldId, reason: 'invented-person' });
                    continue;
                }
                out.push({
                    fieldId,
                    kind: 'owner',
                    source: 'native',
                    title: target.title,
                    value: [person.id],
                    personId: person.id,
                    display: person.name || person.id,
                });
                continue;
            }
            const mentioned = matchPerson(raw.personId || raw.value || raw.name, allowedPeople);
            const option = matchOption(raw.optionId || raw.value || raw.label, target.options || [])
                || (mentioned ? matchOption(mentioned.name, target.options || []) : null);
            if (!option) {
                skipped.push({ fieldId, reason: 'invented-person' });
                continue;
            }
            out.push({
                fieldId,
                kind: 'owner',
                title: target.title,
                value: [option.id],
                optionId: option.id,
                display: option.label || option.id,
            });
        }
    }
    return { suggestions: out, skipped };
}

function selectSuggestionsByFieldIds(suggestions, fieldIds) {
    if (!Array.isArray(fieldIds)) return suggestions || [];
    const allowed = new Set(fieldIds.map((id) => String(id || '').trim()).filter(Boolean));
    if (!allowed.size) return [];
    return (suggestions || []).filter((row) => allowed.has(String(row && row.fieldId)));
}

function planAutofillWrites(suggestions) {
    return (suggestions || []).map((item) => {
        if (item.source === 'native' || item.fieldId === NATIVE_ASSIGNEE_ID) {
            return { type: 'assignee', fieldId: item.fieldId, value: item.value };
        }
        let fieldValue = item.value;
        if (item.kind === 'date') fieldValue = parseDateValue(item.value);
        return {
            type: 'customField',
            fieldId: item.fieldId,
            updateDetail: { _id: item.fieldId, fieldValue },
        };
    }).filter((row) => row.type !== 'customField' || row.updateDetail.fieldValue != null);
}

function parseSuggestionsPayload(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    const tryParse = (body) => {
        try {
            const parsed = JSON.parse(body);
            if (parsed && Array.isArray(parsed.suggestions)) return parsed.suggestions;
            if (Array.isArray(parsed)) return parsed;
        } catch (_e) {
            return null;
        }
        return null;
    };
    const direct = tryParse(text);
    if (direct) return direct;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        const nested = tryParse(fenced[1]);
        if (nested) return nested;
    }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
        const nested = tryParse(text.slice(first, last + 1));
        if (nested) return nested;
    }
    return [];
}

function buildAutofillPrompt({ task, targets, people, description, comments, pages }) {
    const title = clamp(String((task && (task.TaskName || task.title)) || ''), TITLE_CAP) || '(untitled task)';
    const key = String((task && task.TaskKey) || '').trim();
    const lines = [
        `Task: ${key ? `${key} ` : ''}${title}`,
        `Description: ${description || '(empty)'}`,
    ];
    const notes = commentTexts(comments);
    if (notes.length) {
        lines.push('Comments:');
        notes.forEach((row) => lines.push(`- ${row.message}`));
    }
    const linked = pageTexts(pages);
    if (linked.length) {
        lines.push('Linked pages:');
        linked.forEach((row) => lines.push(`- ${row.title}${row.text ? `: ${row.text}` : ''}`));
    }
    const allowedPeople = normalizePeople(people);
    if (allowedPeople.length) {
        lines.push('People the caller can assign (id | name):');
        allowedPeople.forEach((person) => lines.push(`- ${person.id} | ${person.name || '(unnamed)'}`));
    }
    lines.push('Empty fields to fill (use these fieldId values exactly):');
    for (const target of targets || []) {
        if (target.kind === 'tag' || (target.kind === 'owner' && target.options)) {
            const options = (target.options || []).map((row) => `${row.id}:${row.label}`).join(', ');
            lines.push(`- [${target.kind}] ${target.fieldId} "${target.title}" options: ${options || '(none)'}`);
        } else if (target.source === 'native') {
            lines.push(`- [owner] ${target.fieldId} "${target.title}" (native assignee; use a person id from the list)`);
        } else {
            lines.push(`- [${target.kind}] ${target.fieldId} "${target.title}"`);
        }
    }
    lines.push('', 'Return JSON: { "suggestions": [ { "fieldId": "", "kind": "summary|date|owner|tag", "value": "", "optionId": "", "personId": "" } ] }');
    lines.push('Only listed empty fields. Dates as YYYY-MM-DD. Tags must be an option id. People must be a listed person id. Skip a field rather than invent.');
    return lines.join('\n');
}

const AUTOFILL_SYSTEM = `You fill empty task fields from the task the author can already see.

Return a single JSON object:
{ "suggestions": [ { "fieldId": "<id from the empty-field list>", "kind": "summary|date|owner|tag", "value": "<text or YYYY-MM-DD>", "optionId": "<dropdown option id>", "personId": "<person id>" } ] }
No preamble, no code fences around the JSON.

Rules:
- Suggest only for listed empty fields. Do not invent fields, people, tags, or dates.
- summary: a short grounded value from the title, description, comments, or linked page text.
- date: YYYY-MM-DD, only when the task text supports it.
- tag: optionId must be one of that field's listed options.
- owner: personId must be a listed person, or optionId a listed option for an owner dropdown.
- Prefer skip over guess. Do not mention that you are an AI.`;

function previewFromParts(input, rawSuggestions) {
    const permissions = (input && input.permissions) || {};
    const gate = permissionGate(permissions);
    if (!gate.allowed) return { status: false, reason: gate.reason, data: { apply: false, suggestions: [], skipped: [] } };

    const task = (input && input.task) || {};
    const title = clamp(String(task.TaskName || task.title || ''), TITLE_CAP);
    const description = input && input.description != null ? clamp(stripHtml(input.description), TEXT_CAP) : descriptionText(task);
    const comments = commentTexts(input && input.comments);
    const pages = pageTexts(input && input.pages);
    const people = normalizePeople(input && input.people);
    const targets = listEmptyTargets({
        task,
        fields: input && input.fields,
        people,
        permissions,
    });

    if (!targets.length) {
        return {
            status: true,
            data: { apply: false, suggestions: [], skipped: [], targets, reason: 'nothing-empty' },
        };
    }

    const proposed = Array.isArray(rawSuggestions)
        ? rawSuggestions
        : heuristicSuggestions({ targets, people, title, description, comments, pages });
    const sanitized = sanitizeSuggestions(proposed, { targets, people, task });
    return {
        status: true,
        data: {
            apply: false,
            suggestions: sanitized.suggestions,
            skipped: sanitized.skipped,
            targets: targets.map((target) => ({
                fieldId: target.fieldId,
                kind: target.kind,
                title: target.title,
                source: target.source || 'customField',
            })),
        },
    };
}

module.exports = {
    AUTOFILL_ACTIONS,
    AUTOFILL_SYSTEM,
    NATIVE_ASSIGNEE_ID,
    OBJECT_ID,
    isAiAction,
    isWritablePermission,
    kindForField,
    isCustomFieldEmpty,
    isAssigneeEmpty,
    permissionGate,
    listEmptyTargets,
    sanitizeSuggestions,
    heuristicSuggestions,
    selectSuggestionsByFieldIds,
    planAutofillWrites,
    parseSuggestionsPayload,
    buildAutofillPrompt,
    previewFromParts,
    descriptionText,
    commentTexts,
    pageTexts,
    parseDateValue,
    recordId,
    stripHtml,
    clamp,
};

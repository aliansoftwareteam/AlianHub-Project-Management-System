'use strict';

const AUTOFILL_ACTIONS = ['preview', 'apply'];
const NATIVE_ASSIGNEE_ID = 'assignee';
const NATIVE_DUE_ID = 'due';
const SUMMARY_TYPES = new Set(['text', 'textarea']);
const DATE_TYPES = new Set(['date']);
const TAG_TYPES = new Set(['dropdown']);
const OWNER_TITLE = /\b(owner|assignee|people|person|lead)\b/i;
const DUE_TITLE = /\b(due|deadline)\b/i;
const ISO_DATE = /\b(20\d{2}-\d{2}-\d{2})\b/;
const DATE_PLACEHOLDER = /^(dd|mm|yyyy)([/.-])(dd|mm|yyyy)\2(dd|mm|yyyy)$/i;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MONTH_INDEX = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
};
const MONTH_NAME = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

const TITLE_CAP = 400;
const TEXT_CAP = 2400;
const SUMMARY_VALUE_CAP = 2000;
const COMMENT_CAP = 12;
const PAGE_CAP = 4;

function recordId(row) {
    if (row == null) return '';
    if (typeof row === 'string' || typeof row === 'number') {
        const raw = String(row).trim();
        return raw === '[object Object]' ? '' : raw;
    }
    if (typeof row.toHexString === 'function') {
        const hex = String(row.toHexString()).trim();
        if (OBJECT_ID.test(hex)) return hex;
    }
    const nested = row._id || row.id;
    if (nested && nested !== row) {
        const inner = recordId(nested);
        if (inner) return inner;
    }
    if (typeof row.toString === 'function') {
        const asString = String(row.toString()).trim();
        if (OBJECT_ID.test(asString)) return asString;
    }
    return '';
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
    if (type === 'people' || type === 'person') {
        return OWNER_TITLE.test(String((field && field.fieldTitle) || '')) ? 'owner' : null;
    }
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

function utcDate(year, month, day) {
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
    return date;
}

function isEmptyValue(value) {
    if (value == null) return true;
    if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
    if (Array.isArray(value)) return value.filter((item) => item !== '' && item != null).length === 0;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return true;
        if (DATE_PLACEHOLDER.test(trimmed)) return true;
        if (trimmed.toLowerCase() === 'invalid date') return true;
        return false;
    }
    if (value instanceof Date) return Number.isNaN(value.getTime());
    if (typeof value === 'object') {
        if (Object.prototype.hasOwnProperty.call(value, 'fieldValue')) return isEmptyValue(value.fieldValue);
        if (Object.prototype.hasOwnProperty.call(value, 'date')) return isEmptyValue(value.date);
        if (Object.prototype.hasOwnProperty.call(value, 'seconds')) return !Number(value.seconds);
        if (Object.prototype.hasOwnProperty.call(value, '$date')) return isEmptyValue(value.$date);
        return Object.keys(value).length === 0;
    }
    return false;
}

function isCustomFieldEmpty(task, field) {
    const id = recordId(field);
    const entry = customFieldEntry(task, id);
    return isEmptyValue(entry && Object.prototype.hasOwnProperty.call(entry, 'fieldValue') ? entry.fieldValue : undefined);
}

function isAssigneeEmpty(task, people) {
    const raw = task && task.AssigneeUserId;
    const list = Array.isArray(raw) ? raw : (raw != null && raw !== '' ? [raw] : []);
    const ids = list
        .filter((item) => typeof item === 'string' || typeof item === 'number')
        .map(recordId)
        .filter((id) => id && id !== '0' && id.toLowerCase() !== 'unassigned');
    if (!ids.length) return true;
    const allowed = normalizePeople(people);
    if (!allowed.length) return false;
    return !ids.some((id) => allowed.some((person) => person.id === id));
}

function isDueDateEmpty(task) {
    return isEmptyValue(task && task.DueDate);
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

    if (gate.assignee && isAssigneeEmpty(task, allowedPeople)) {
        targets.push({
            fieldId: NATIVE_ASSIGNEE_ID,
            kind: 'owner',
            source: 'native',
            title: 'Assignee',
            people: allowedPeople,
        });
    }

    if (gate.customField && isDueDateEmpty(task) && !targets.some((row) => row.kind === 'date')) {
        targets.push({
            fieldId: NATIVE_DUE_ID,
            kind: 'date',
            source: 'native',
            title: 'Due Date',
        });
    }

    return targets;
}

function parseDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    }
    const raw = String(value || '').trim();
    if (!raw || DATE_PLACEHOLDER.test(raw)) return null;
    const iso = raw.match(ISO_DATE);
    const stamp = iso ? iso[1] : '';
    if (stamp) {
        const [year, month, day] = stamp.split('-').map(Number);
        return utcDate(year, month - 1, day);
    }
    const slash = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})$/);
    if (slash) {
        const a = Number(slash[1]);
        const b = Number(slash[2]);
        const year = Number(slash[3]);
        if (a > 12) return utcDate(year, b - 1, a);
        if (b > 12) return utcDate(year, a - 1, b);
        return utcDate(year, b - 1, a);
    }
    return null;
}

function pushStamp(stamps, date) {
    if (date) stamps.push(date);
}

function extractDateStamps(text) {
    const raw = String(text || '');
    const stamps = [];
    const isoRe = /\b(20\d{2}-\d{2}-\d{2})\b/g;
    let match;
    while ((match = isoRe.exec(raw))) {
        pushStamp(stamps, parseDateValue(match[1]));
    }
    const rangeRe = new RegExp(`\\b(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+(${MONTH_NAME})\\.?\\s+(20\\d{2})\\b`, 'gi');
    while ((match = rangeRe.exec(raw))) {
        const month = MONTH_INDEX[String(match[3] || '').slice(0, 3).toLowerCase()];
        if (month == null) continue;
        pushStamp(stamps, utcDate(Number(match[4]), month, Number(match[2])));
    }
    const dayMonthRe = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAME})\\.?\\s+(20\\d{2})\\b`, 'gi');
    while ((match = dayMonthRe.exec(raw))) {
        const month = MONTH_INDEX[String(match[2] || '').slice(0, 3).toLowerCase()];
        if (month == null) continue;
        pushStamp(stamps, utcDate(Number(match[3]), month, Number(match[1])));
    }
    const monthDayRe = new RegExp(`\\b(${MONTH_NAME})\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, 'gi');
    while ((match = monthDayRe.exec(raw))) {
        const month = MONTH_INDEX[String(match[1] || '').slice(0, 3).toLowerCase()];
        if (month == null) continue;
        pushStamp(stamps, utcDate(Number(match[3]), month, Number(match[2])));
    }
    const slashRe = /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/g;
    while ((match = slashRe.exec(raw))) {
        pushStamp(stamps, parseDateValue(match[0]));
    }
    return stamps;
}

function pickDueDate(text, fieldPastFuture) {
    const stamps = extractDateStamps(text);
    for (let i = stamps.length - 1; i >= 0; i -= 1) {
        if (dateAllowed(stamps[i], fieldPastFuture)) return stamps[i];
    }
    return null;
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

function sprintDueStamp(task, sprint) {
    const end = sprint && (sprint.endDate || sprint.EndDate || sprint.end);
    const fromEnd = parseDateValue(end);
    if (fromEnd) return fromEnd;
    const name = String(
        (sprint && (sprint.name || sprint.sprintName))
        || (task && (task.sprintName || (task.sprintArray && task.sprintArray.name)))
        || '',
    );
    const stamps = extractDateStamps(name);
    return stamps.length ? stamps[stamps.length - 1] : null;
}

function suggestionHaystack({ title, description, comments, pages, task, sprint }) {
    const commentsText = (comments || []).map((row) => row.message || stripHtml(row)).join(' ');
    const pagesText = (pages || []).map((row) => `${row.title || ''} ${row.text || ''}`).join(' ');
    const sprintName = String(
        (sprint && (sprint.name || sprint.sprintName))
        || (task && (task.sprintName || (task.sprintArray && task.sprintArray.name)))
        || '',
    );
    const due = sprintDueStamp(task, sprint);
    const sprintEnd = due ? due.toISOString().slice(0, 10) : '';
    return `${title || ''} ${sprintName} ${sprintEnd} ${description || ''} ${commentsText} ${pagesText}`.toLowerCase();
}

function heuristicSuggestions({ targets, people, title, description, comments, pages, task, sprint }) {
    const haystack = suggestionHaystack({ title, description, comments, pages, task, sprint });
    const allowedPeople = normalizePeople(people);
    const suggestions = [];
    for (const target of targets || []) {
        if (target.kind === 'summary') {
            const value = clamp(description || title, SUMMARY_VALUE_CAP);
            if (value) suggestions.push({ fieldId: target.fieldId, kind: 'summary', value });
            continue;
        }
        if (target.kind === 'date') {
            let stamp = pickDueDate(`${description || ''} ${title || ''} ${haystack}`, target.fieldPastFuture);
            if (!stamp) stamp = sprintDueStamp(task, sprint);
            if (stamp && dateAllowed(stamp, target.fieldPastFuture)) {
                suggestions.push({ fieldId: target.fieldId, kind: 'date', value: stamp.toISOString().slice(0, 10) });
            }
            continue;
        }
        if (target.kind === 'tag') {
            const option = (target.options || []).find((row) => row.label && haystack.includes(row.label.toLowerCase()));
            if (option) suggestions.push({ fieldId: target.fieldId, kind: 'tag', optionId: option.id, value: option.label });
            continue;
        }
        if (target.kind === 'owner') {
            const mentioned = allowedPeople.find((person) => person.name && haystack.includes(person.name.toLowerCase()));
            const leaderId = recordId(task && (task.Task_Leader || task.createdBy || task.createdById));
            const leader = leaderId ? allowedPeople.find((person) => person.id === leaderId) : null;
            if (target.source === 'native') {
                const person = mentioned || leader;
                if (person) suggestions.push({ fieldId: target.fieldId, kind: 'owner', personId: person.id, value: person.name });
                continue;
            }
            const option = (target.options || []).find((row) => {
                if (!row.label) return false;
                const label = row.label.toLowerCase();
                if (haystack.includes(label)) return true;
                return Boolean(mentioned && mentioned.name && mentioned.name.toLowerCase() === label);
            });
            if (option) {
                suggestions.push({ fieldId: target.fieldId, kind: 'owner', optionId: option.id, value: option.label });
                continue;
            }
            const person = mentioned || leader;
            if (person && !(target.options || []).length) {
                suggestions.push({ fieldId: target.fieldId, kind: 'owner', personId: person.id, value: person.name });
            }
        }
    }
    return suggestions;
}

function skipReasonWhenMissingTarget(fieldId, task, people) {
    if (!fieldId) return 'unknown';
    if (fieldId === NATIVE_ASSIGNEE_ID) return isAssigneeEmpty(task, people) ? 'unknown' : 'filled';
    if (fieldId === NATIVE_DUE_ID) return isDueDateEmpty(task) ? 'unknown' : 'filled';
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
            skipped.push({ fieldId, reason: skipReasonWhenMissingTarget(fieldId, task, allowedPeople) });
            continue;
        }
        if (target.source === 'native') {
            if (target.kind === 'date') {
                if (!isDueDateEmpty(task)) {
                    skipped.push({ fieldId, reason: 'filled' });
                    continue;
                }
            } else if (!isAssigneeEmpty(task, allowedPeople)) {
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
            if (target.source === 'native' || !(target.options || []).length) {
                const person = matchPerson(raw.personId || raw.value || raw.name, allowedPeople);
                if (!person) {
                    skipped.push({ fieldId, reason: 'invented-person' });
                    continue;
                }
                out.push({
                    fieldId,
                    kind: 'owner',
                    source: target.source || 'customField',
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
        if (item.fieldId === NATIVE_ASSIGNEE_ID || (item.source === 'native' && item.kind === 'owner')) {
            return { type: 'assignee', fieldId: item.fieldId, value: item.value };
        }
        if (item.fieldId === NATIVE_DUE_ID || (item.source === 'native' && item.kind === 'date')) {
            return { type: 'dueDate', fieldId: item.fieldId, value: parseDateValue(item.value) };
        }
        let fieldValue = item.value;
        if (item.kind === 'date') fieldValue = parseDateValue(item.value);
        return {
            type: 'customField',
            fieldId: item.fieldId,
            updateDetail: { _id: item.fieldId, fieldValue },
            alsoDueDate: item.kind === 'date' && DUE_TITLE.test(String(item.title || '')),
        };
    }).filter((row) => {
        if (row.type === 'dueDate') return row.value != null;
        if (row.type === 'customField') return row.updateDetail.fieldValue != null;
        return true;
    });
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

function buildAutofillPrompt({ task, targets, people, description, comments, pages, sprint }) {
    const title = clamp(String((task && (task.TaskName || task.title)) || ''), TITLE_CAP) || '(untitled task)';
    const key = String((task && task.TaskKey) || '').trim();
    const lines = [
        `Task: ${key ? `${key} ` : ''}${title}`,
        `Description: ${description || '(empty)'}`,
    ];
    const due = sprintDueStamp(task, sprint);
    const sprintName = String(
        (sprint && (sprint.name || sprint.sprintName))
        || (task && (task.sprintName || (task.sprintArray && task.sprintArray.name)))
        || '',
    );
    if (sprintName || due) {
        lines.push(`Sprint: ${sprintName || '(unnamed)'}${due ? ` (ends ${due.toISOString().slice(0, 10)})` : ''}`);
    }
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
- date: YYYY-MM-DD. A sprint end date is grounded. Do not invent other dates.
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

    const proposed = Array.isArray(rawSuggestions) ? rawSuggestions : [];
    const heuristic = heuristicSuggestions({
        targets, people, title, description, comments, pages, task, sprint: input && input.sprint,
    });
    const byField = new Map();
    proposed.forEach((row) => {
        const id = recordId(row && (row.fieldId || row.id));
        if (id && !byField.has(id)) byField.set(id, row);
    });
    heuristic.forEach((row) => {
        const id = recordId(row && row.fieldId);
        if (id && !byField.has(id)) byField.set(id, row);
    });
    const sanitized = sanitizeSuggestions([...byField.values()], { targets, people, task });
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
    NATIVE_DUE_ID,
    OBJECT_ID,
    isAiAction,
    isWritablePermission,
    kindForField,
    isEmptyValue,
    isCustomFieldEmpty,
    isAssigneeEmpty,
    isDueDateEmpty,
    permissionGate,
    listEmptyTargets,
    sanitizeSuggestions,
    heuristicSuggestions,
    sprintDueStamp,
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

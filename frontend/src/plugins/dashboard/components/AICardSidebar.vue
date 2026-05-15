<template>
    <Sidebar
        :width="sidebarWidth"
        :title="$t('AICard.title')"
        :visible="visible"
        @update:visible="(val) => $emit('update:visible', val)"
    >
        <template #body>
            <div class="ai-card-sidebar">
                <!-- INPUT STATE -->
                <template v-if="!isGenerating && !generatedCard && !error">
                    <div class="ai-card-section">
                        <h4 class="ai-card-section-title">{{ $t('AICard.prompt_label') }}</h4>
                        <p class="ai-card-section-hint">{{ $t('AICard.prompt_subtitle') }}</p>
                    </div>

                    <textarea
                        v-model="userPrompt"
                        class="ai-card-textarea"
                        rows="4"
                        :placeholder="$t('AICard.prompt_placeholder')"
                        :maxlength="MAX_PROMPT_LENGTH"
                    ></textarea>
                    <div class="ai-card-textarea-meta">
                        <span :class="['ai-card-helper', { 'ai-card-helper-warn': hintIsWarn }]">{{ hintText }}</span>
                        <span class="ai-card-counter">{{ userPrompt.length }} / {{ MAX_PROMPT_LENGTH }}</span>
                    </div>

                    <div v-if="suggestions.length" class="ai-card-section">
                        <h4 class="ai-card-section-title">{{ $t('AICard.examples_heading') }}</h4>
                        <div class="ai-card-chips">
                            <button
                                v-for="s in suggestions"
                                :key="s.id"
                                type="button"
                                class="ai-card-chip"
                                @click="useSuggestion(s.prompt)"
                            >
                                {{ s.label }}
                            </button>
                        </div>
                    </div>

                    <div class="ai-card-actions">
                        <button
                            type="button"
                            class="ai-card-btn-primary"
                            :disabled="!canGenerate"
                            @click="generateCard()"
                        >
                            {{ $t('AICard.generate') }}
                        </button>
                    </div>
                </template>

                <!-- GENERATING STATE -->
                <div v-if="isGenerating" class="ai-card-loading">
                    <Spinner :isSpinner="true" />
                    <p class="ai-card-loading-text">{{ $t('AICard.generating') }}</p>
                </div>

                <!-- PREVIEW STATE -->
                <template v-if="!isGenerating && generatedCard">
                    <div class="ai-card-preview">
                        <h4 class="ai-card-section-title mb-12px">{{ $t('AICard.preview_heading') }}</h4>
                        <dl class="ai-card-preview-list">
                            <div class="ai-card-preview-row">
                                <dt>{{ $t('AICard.card_type') }}</dt>
                                <dd>{{ generatedCard._cardTypeLabel }}</dd>
                            </div>
                            <div class="ai-card-preview-row">
                                <dt>{{ $t('AICard.card_name') }}</dt>
                                <dd>{{ generatedCard.cardData.fieldName }}</dd>
                            </div>
                            <div v-if="generatedCard._projectNames.length" class="ai-card-preview-row">
                                <dt>{{ $t('AICard.projects') }}</dt>
                                <dd>{{ generatedCard._projectNames.join(', ') }}</dd>
                            </div>
                            <div v-if="generatedCard.filterData && generatedCard.filterData.length" class="ai-card-preview-row">
                                <dt>{{ $t('AICard.filters') }}</dt>
                                <dd>
                                    <span v-for="(f, i) in generatedCard.filterData" :key="i" class="ai-card-filter-tag">
                                        {{ f.filterOn }}: {{ Array.isArray(f.comparisonsData) ? f.comparisonsData.join(', ') : f.comparisonsData }}
                                    </span>
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <div class="ai-card-actions">
                        <button type="button" class="ai-card-btn-secondary" @click="reset()">{{ $t('AICard.regenerate') }}</button>
                        <button type="button" class="ai-card-btn-primary" @click="commit()">{{ $t('AICard.add_to_dashboard') }}</button>
                    </div>
                </template>

                <!-- ERROR STATE -->
                <template v-if="!isGenerating && error">
                    <div class="ai-card-error">
                        <strong class="ai-card-error-heading">{{ $t('AICard.error_heading') }}</strong>
                        <p class="ai-card-error-text">{{ error }}</p>
                    </div>
                    <div class="ai-card-actions">
                        <button type="button" class="ai-card-btn-secondary" @click="reset()">{{ $t('AICard.try_again') }}</button>
                    </div>
                </template>
            </div>
        </template>
    </Sidebar>
</template>

<script setup>
import { ref, computed, inject, defineProps, defineEmits } from 'vue';
import { useStore } from 'vuex';
import { useI18n } from 'vue-i18n';
import { useToast } from 'vue-toast-notification';
import Swal from 'sweetalert2';
import { useRouter } from 'vue-router';

import Sidebar from '@/components/molecules/Sidebar/Sidebar.vue';
import Spinner from '@/components/atom/SpinnerComp/SpinnerComp.vue';

import { apiRequest } from '@/services';
import { useCustomComposable } from '@/composable';

// NOTE: Intentionally NOT using composable/aiHelper.js#useAiApiFunction().
// The existing helper has two silent-bail bugs that block dashboard-context
// callers:
//   1. composable/index.js#checkGenerateResponseLimit doesn't guard against
//      `companyUsers` being undefined; the resulting TypeError is swallowed
//      by aiHelper's outer try/catch and surfaces here as a generic rejection
//      with no actionable detail.
//   2. checkPermission's `globalPermission` default is `true`, but the
//      function selects projectRules unless globalPermission === true
//      (strict equality). Passing `null` from a non-project surface (like
//      the dashboard header) silently lands in projectRules → returns null →
//      checkGenerateResponseLimit returns false → resolve({status:false,
//      isReachedLimit:true}) → user sees "Ai_limit_reached" toast even when
//      they have plenty of quota.
// Patching the shared helper is out of scope for this feature. We replicate
// the parts we need (plan check + Swal upgrade dialog + direct apiRequest)
// inline so this button doesn't depend on the broken chain. The backend's
// limitCountUpdate still increments per request, so quota enforcement
// remains in place server-side.

// Static identifier of the prompt entry seeded into utils/aiPrompts.json.
// Backend looks it up by _id when the frontend calls /api/v1/generatePrompt.
const DASHBOARD_CARD_PROMPT_ID = '67ff000000000000aicard001';

// Filter fields the dashboard's existing card editor accepts. Anything the AI
// emits outside this whitelist gets dropped before the preview, so a
// hallucinated filterOn can't corrupt the saved card.
const VALID_FILTER_FIELDS = [
    'statusKey', 'DueDate', 'Task_Priority', 'Task_Leader',
    'TaskTypeKey', 'tagsArray', 'AssigneeUserId'
];

// Prompt length policy — surfaced both as the textarea maxlength and as
// the inline helper text below it.
const MIN_PROMPT_LENGTH = 5;
const MAX_PROMPT_LENGTH = 500;

// Mobile breakpoint — under this, the sidebar takes the full viewport.
const MOBILE_BREAKPOINT = 767;

const props = defineProps({
    visible: { type: Boolean, default: false },
    allProjectsArray: { type: Array, default: () => [] },
    cardComponent: { type: Array, default: () => [] }
});

const emit = defineEmits(['update:visible', 'card-generated']);

const { t } = useI18n();
const $toast = useToast();
const { getters } = useStore();
const { makeUniqueId } = useCustomComposable();
const router = useRouter();

const userId = inject('$userId');
const companyId = inject('$companyId');
// $clientWidth is provided globally from App.vue and updates on resize,
// so the responsive width recomputes automatically.
const clientWidth = inject('$clientWidth');

// Read selectedCompany directly so we can run the plan check inline.
const selectedCompany = computed(() => getters['settings/selectedCompany']);

const userPrompt = ref('');
const isGenerating = ref(false);
const generatedCard = ref(null);
const error = ref(null);

const canGenerate = computed(() => userPrompt.value && userPrompt.value.trim().length >= MIN_PROMPT_LENGTH);

// Full viewport width on phones, fixed comfortable width on desktop.
const sidebarWidth = computed(() => {
    const w = (clientWidth && clientWidth.value) || 1024;
    return w <= MOBILE_BREAKPOINT ? '100vw' : '600px';
});

// Inline hint shown under the textarea. Returns empty once the prompt is
// long enough; counter remains visible on the right regardless.
const hintText = computed(() => {
    const len = userPrompt.value.trim().length;
    if (!len) return t('AICard.helper_idle', { n: MIN_PROMPT_LENGTH });
    if (len < MIN_PROMPT_LENGTH) {
        return t('AICard.helper_more', { remaining: MIN_PROMPT_LENGTH - len });
    }
    return '';
});
const hintIsWarn = computed(() => {
    const len = userPrompt.value.trim().length;
    return len > 0 && len < MIN_PROMPT_LENGTH;
});

// Quick-pick prompt chips. Each entry has an id (stable key), a short label
// (the chip text) and the full prompt that gets dropped into the textarea on
// click. Chips are filtered against the card catalogue when possible — a
// chip whose underlying cardType isn't in the company's catalogue is
// suppressed so the chip can't propose something we know the AI will fail to
// build.
const ALL_SUGGESTIONS = [
    { id: 'workload',  needs: 'workload',     labelKey: 'AICard.chip_workload',  promptKey: 'AICard.chip_workload_prompt' },
    { id: 'assignee',  needs: 'assignees',    labelKey: 'AICard.chip_assignee',  promptKey: 'AICard.chip_assignee_prompt' },
    { id: 'urgent',    needs: null,           labelKey: 'AICard.chip_urgent',    promptKey: 'AICard.chip_urgent_prompt' },
    { id: 'calendar',  needs: null,           labelKey: 'AICard.chip_calendar',  promptKey: 'AICard.chip_calendar_prompt' },
    { id: 'time',      needs: 'time_tracking', labelKey: 'AICard.chip_time',     promptKey: 'AICard.chip_time_prompt' }
];
const availableCardTypes = computed(() => new Set((props.cardComponent || []).map((c) => c.cardType)));
const suggestions = computed(() => {
    const types = availableCardTypes.value;
    return ALL_SUGGESTIONS
        .filter((s) => !s.needs || types.has(s.needs))
        .map((s) => ({ id: s.id, label: t(s.labelKey), prompt: t(s.promptKey) }));
});

function useSuggestion(promptText) {
    userPrompt.value = String(promptText || '').slice(0, MAX_PROMPT_LENGTH);
}

// Some option ids in cardComponent.json are stored as Mongo Extended JSON
// (`{ "$numberLong": "3" }`) rather than raw numbers. Collapse them to a
// primitive so they match the value the user picks in the manual editor and
// the validators downstream.
function normalizeOptionId(rawId) {
    if (rawId && typeof rawId === 'object' && rawId.$numberLong !== undefined) {
        const n = Number(rawId.$numberLong);
        return Number.isFinite(n) ? n : rawId.$numberLong;
    }
    return rawId;
}

// One line per configurable field, telling the model the field name, its
// type, whether it's required, valid IDs (for enums), and the default. The
// model uses this to fully populate cardData for each card — otherwise it
// omits per-card fields like `logtype`/`measure`/`calculation`/`timerange`
// and the dashboard renders the card with `undefined` values.
//
// Multi-select vs single-select dropdowns are distinguished by whether the
// catalogue's `value` default is an array. That's how the manual editor's
// CardFieldComponent decides between a chip-style picker and a single
// dropdown, so we mirror it here.
function summarizeFieldForPrompt(field) {
    if (!field || !field.name) return null;
    if (field.type === 'filter') return null;           // filterData is its own thing
    if (field.disabled || field.hidden) return null;    // user can't change → don't ask AI to
    const required = /required/i.test(field.rules || '') ? ' (required)' : '';
    const normalizedDefault = field.type === 'dropdown' ? normalizeOptionId(field.value) : field.value;
    const hasDefault = normalizedDefault !== undefined && normalizedDefault !== null && normalizedDefault !== ''
        && !(Array.isArray(normalizedDefault) && !normalizedDefault.length);
    const defaultPart = hasDefault ? `, default ${JSON.stringify(normalizedDefault)}` : '';
    switch (field.type) {
        case 'text':
            return `${field.name}: text${required}${defaultPart}`;
        case 'radio':
            return `${field.name}: boolean${required}${defaultPart}`;
        case 'dropdown': {
            const multi = Array.isArray(field.value);
            if (Array.isArray(field.options) && field.options.length) {
                const opts = field.options
                    .map((o) => `${JSON.stringify(normalizeOptionId(o.id))}=${o.name}`)
                    .join(', ');
                const shape = multi ? 'array of enum ids' : 'enum';
                return `${field.name}: ${shape}${required} {${opts}}${defaultPart}`;
            }
            // Empty-options dropdowns are runtime-populated. Point the model
            // at the relevant USER_CONTEXT list instead of guessing.
            if (field.name === 'projectId') {
                return `${field.name}: array of project IDs${required} (use USER_CONTEXT.projects[].id)`;
            }
            if (field.name === 'AssigneeUserId') {
                return `${field.name}: array of user IDs${required} (use USER_CONTEXT.members[].id)`;
            }
            if (field.name === 'statusArray') {
                return `${field.name}: array of status keys${required} (use USER_CONTEXT.statusKeys)`;
            }
            return `${field.name}: array of IDs${required}`;
        }
        default:
            return `${field.name}: ${field.type}${required}${defaultPart}`;
    }
}

// Build a compact text description of the available card types so the model
// can pick one. We deliberately summarise the catalogue rather than dump the
// full JSON — keeps the prompt small and steers the model toward valid IDs.
// The per-card description is resolved through vue-i18n so the model sees a
// human sentence ("Pie chart of workload grouped by status") rather than the
// raw key ("workload_by_status_pie_chart_description"). Each card's
// configurable fields are listed on indented lines so the model can fully
// populate cardData — not just fieldName / projectId.
function buildCatalogueSummary() {
    if (!props.cardComponent || !props.cardComponent.length) return '(no cards available)';
    // De-duplicate by componentId (the catalogue has 3x TotalUrgentTasksComp).
    const seen = new Set();
    const lines = [];
    props.cardComponent.forEach((card) => {
        if (seen.has(card.key)) return;
        seen.add(card.key);
        let description = '';
        if (card.description) {
            const key = `dashboardCard.${card.description}`;
            const translated = t(key);
            if (translated && translated !== key) description = translated;
        }
        const descSegment = description ? ` — ${description}` : '';
        lines.push(`* ${card.key}${descSegment}`);
        const fieldLines = (card.fields || []).map(summarizeFieldForPrompt).filter(Boolean);
        fieldLines.forEach((fl) => lines.push(`    ${fl}`));
    });
    return lines.join('\n');
}

// Build the runtime context — project IDs/names, status keys, priorities,
// company members (for AssigneeUserId / Task_Leader filters), and task types
// (for TaskTypeKey filters). Keep it short; the substituted value gets inlined
// into the system prompt. Wrapped in defensive guards because the store getters
// vary in shape across companies (some return arrays, some objects/maps, some
// haven't been hydrated yet) and an exception here would silently bail
// generateCard before the API call ever fires.
//
// Tags are intentionally NOT included — the codebase has no central tag
// catalogue (tags live on each task as `tagsArray` strings), so the model
// uses whatever tag the user names verbatim, matching how the manual filter
// UI behaves.
function buildUserContext() {
    let projects = [];
    let statusKeys = [];
    let priorityKeys = [];
    let members = [];
    let taskTypes = [];
    try {
        projects = (Array.isArray(props.allProjectsArray) ? props.allProjectsArray : [])
            .map((p) => ({ id: p && p._id, name: p && p.ProjectName }))
            .filter((p) => p.id);
    } catch (e) { console.warn('buildUserContext: project list failed', e); }
    try {
        const statusRaw = getters['settings/AllTaskStatus'];
        const statusArr = Array.isArray(statusRaw) ? statusRaw : (statusRaw ? Object.values(statusRaw) : []);
        statusKeys = Array.from(new Set(statusArr.map((s) => s && (s.key || s.statusKey)).filter(Boolean)));
    } catch (e) { console.warn('buildUserContext: status keys failed', e); }
    try {
        const prioRaw = getters['priority/getAllPriorities'];
        const prioArr = Array.isArray(prioRaw) ? prioRaw : (prioRaw ? Object.values(prioRaw) : []);
        priorityKeys = Array.from(new Set(prioArr.map((p) => p && p.key).filter(Boolean)));
    } catch (e) { console.warn('buildUserContext: priority keys failed', e); }
    try {
        const usersRaw = getters['settings/companyUsers'];
        const usersArr = Array.isArray(usersRaw) ? usersRaw : (usersRaw ? Object.values(usersRaw) : []);
        // Drop deleted users; surface only the fields the model needs.
        members = usersArr
            .filter((u) => u && u.userId && u.isDelete !== true)
            .map((u) => ({ id: u.userId, name: u.Employee_Name }))
            .filter((u) => u.name);
    } catch (e) { console.warn('buildUserContext: members failed', e); }
    try {
        const typesRaw = getters['settings/AllTaskType'];
        const typesArr = Array.isArray(typesRaw) ? typesRaw : (typesRaw ? Object.values(typesRaw) : []);
        taskTypes = typesArr
            .map((tt) => ({ key: tt && tt.key, name: tt && (tt.name || tt.title) }))
            .filter((tt) => tt.key);
    } catch (e) { console.warn('buildUserContext: task types failed', e); }
    return JSON.stringify({ projects, statusKeys, priorityKeys, members, taskTypes });
}

// Extract a JSON object out of the AI's raw text response. Models occasionally
// wrap the JSON in code fences / commentary despite the prompt's instructions,
// so we look for the outermost balanced braces and parse that.
function parseAiResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    // Strip code fences if present.
    let text = rawText.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    // Find first '{' and last '}' for a best-effort JSON slice.
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
        return JSON.parse(candidate);
    } catch (e) {
        console.error('Failed to parse AI card JSON:', e);
        return null;
    }
}

// Build the validation context for per-field resolvers. Keeps a copy of the
// raw company-users array so we can match member NAMES from the model back
// to userIds, mirroring the project-name fallback. Also includes the
// company's status-key list for QueueListComp.statusArray validation.
function buildValidationContext() {
    let members = [];
    let statusKeys = [];
    try {
        const raw = getters['settings/companyUsers'];
        const arr = Array.isArray(raw) ? raw : (raw ? Object.values(raw) : []);
        members = arr.filter((u) => u && u.userId && u.isDelete !== true);
    } catch (e) { /* fall back to empty list */ }
    try {
        const raw = getters['settings/AllTaskStatus'];
        const arr = Array.isArray(raw) ? raw : (raw ? Object.values(raw) : []);
        statusKeys = arr.map((s) => s && (s.key || s.statusKey)).filter(Boolean);
    } catch (e) { /* fall back to empty list */ }
    return {
        projects: props.allProjectsArray || [],
        members,
        statusKeys
    };
}

// Resolve an AI-supplied projectId (could be an _id, a project name, an array
// of either, or null) into a clean array of real project _ids. Drops what
// can't be matched. Falls back to the first project if nothing resolves.
function resolveProjectIds(rawValue, ctx) {
    const projects = ctx.projects;
    const byId = new Map(projects.map((p) => [String(p._id), p._id]));
    const byNameLower = new Map(
        projects.filter((p) => p && p.ProjectName)
            .map((p) => [String(p.ProjectName).trim().toLowerCase(), p._id])
    );
    const raw = Array.isArray(rawValue) ? rawValue : [rawValue].filter((v) => v !== null && v !== undefined);
    let chosen = raw
        .map((val) => {
            const s = String(val == null ? '' : val).trim();
            if (!s) return null;
            if (byId.has(s)) return byId.get(s);
            return byNameLower.get(s.toLowerCase()) || null;
        })
        .filter(Boolean);
    chosen = Array.from(new Set(chosen));
    if (!chosen.length && projects.length) chosen = [projects[0]._id];
    return chosen;
}

// Same idea for AssigneeUserId — accept userIds or Employee_Names. Returns []
// when nothing matches (the dashboard handles empty assignees by showing all).
function resolveMemberIds(rawValue, ctx) {
    const members = ctx.members;
    const byId = new Map(members.map((m) => [String(m.userId), m.userId]));
    const byNameLower = new Map(
        members.filter((m) => m && m.Employee_Name)
            .map((m) => [String(m.Employee_Name).trim().toLowerCase(), m.userId])
    );
    const raw = Array.isArray(rawValue) ? rawValue : [rawValue].filter((v) => v !== null && v !== undefined);
    const chosen = raw
        .map((val) => {
            const s = String(val == null ? '' : val).trim();
            if (!s) return null;
            if (byId.has(s)) return byId.get(s);
            return byNameLower.get(s.toLowerCase()) || null;
        })
        .filter(Boolean);
    return Array.from(new Set(chosen));
}

// QueueListComp.statusArray: catalogue declares it as a dropdown with empty
// options because the valid values are the company's task-status keys (which
// vary per company). Filter the AI's output to keys we know exist.
function resolveStatusKeys(rawValue, ctx) {
    const validStatuses = new Set((ctx.statusKeys || []).map((k) => String(k)));
    const raw = Array.isArray(rawValue) ? rawValue : [rawValue].filter((v) => v !== null && v !== undefined);
    const chosen = raw
        .map((v) => String(v == null ? '' : v).trim())
        .filter((s) => s && validStatuses.has(s));
    return Array.from(new Set(chosen));
}

// Per-field validator that maps an AI-supplied raw value to a value the
// dashboard's card renderer will actually accept. Anything malformed falls
// back to the catalogue default so the saved card matches what the manual
// editor would produce.
function validateField(field, rawValue, ctx) {
    if (!field || !field.name) return undefined;
    const def = field.value;

    switch (field.type) {
        case 'text': {
            if (typeof rawValue !== 'string' || !rawValue.trim()) return def;
            const maxMatch = /max:(\d+)/.exec(field.rules || '');
            const max = maxMatch ? Number(maxMatch[1]) : 200;
            return rawValue.trim().slice(0, max);
        }
        case 'radio': {
            if (typeof rawValue === 'boolean') return rawValue;
            if (rawValue === 'true') return true;
            if (rawValue === 'false') return false;
            return def;
        }
        case 'dropdown': {
            // Enum dropdown — coerce to one of the option ids. Multi-select is
            // signalled by the default being an array (matches CardFieldComponent's
            // behaviour for manual editing).
            if (Array.isArray(field.options) && field.options.length) {
                const validIds = field.options.map((o) => normalizeOptionId(o.id));
                const multi = Array.isArray(field.value);
                const coerceOne = (candidate) => {
                    if (validIds.includes(candidate)) return candidate;
                    const asNum = Number(candidate);
                    if (Number.isFinite(asNum) && validIds.includes(asNum)) return asNum;
                    const byName = field.options.find(
                        (o) => String(o.name).toLowerCase() === String(candidate).toLowerCase()
                    );
                    if (byName) return normalizeOptionId(byName.id);
                    return null;
                };
                if (multi) {
                    // Multi-select: keep every valid id, normalised + de-duped.
                    const arr = Array.isArray(rawValue)
                        ? rawValue
                        : [rawValue].filter((v) => v !== null && v !== undefined);
                    const cleaned = arr.map(coerceOne).filter((v) => v !== null);
                    const unique = Array.from(new Set(cleaned));
                    return unique.length ? unique : (Array.isArray(def) ? def : []);
                }
                // Single-select: pick the first matchable value.
                const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
                const matched = coerceOne(candidate);
                // Normalise the default too — TASKLIST.groupBy defaults to
                // {"$numberLong":"0"} in the catalogue which the renderer
                // can't handle as-is.
                return matched !== null ? matched : normalizeOptionId(def);
            }
            // Runtime-populated dropdowns.
            if (field.name === 'projectId') return resolveProjectIds(rawValue, ctx);
            if (field.name === 'AssigneeUserId') return resolveMemberIds(rawValue, ctx);
            if (field.name === 'statusArray') return resolveStatusKeys(rawValue, ctx);
            // Unknown empty-options dropdown — accept array shape or fall back.
            return Array.isArray(rawValue) ? rawValue : (rawValue !== undefined ? [rawValue] : def);
        }
        default:
            return rawValue !== undefined ? rawValue : def;
    }
}

// Resolve the parsed AI response against the real catalogue. Walks EVERY
// catalogue field (not just fieldName / projectId) so the saved card has
// the exact shape the manual editor would have produced. Returns
// { componentId, cardId, cardData, filterData, _cardTypeLabel, _projectNames }
// on success, or null with `error.value` populated.
function validateAndResolve(parsed) {
    if (!parsed || typeof parsed !== 'object') {
        error.value = t('AICard.error_invalid_json');
        return null;
    }
    if (parsed.error) {
        error.value = String(parsed.error);
        return null;
    }
    const componentId = parsed.componentId;
    const catalogue = (props.cardComponent || []).find((c) => c.key === componentId);
    if (!catalogue) {
        error.value = t('AICard.error_unknown_card');
        return null;
    }

    const aiCardData = (parsed.cardData && typeof parsed.cardData === 'object') ? parsed.cardData : {};
    const cardData = {};
    const ctx = buildValidationContext();

    // Walk every catalogue field and run the AI value through validateField.
    // Disabled/hidden fields inherit the catalogue default so the saved card
    // is identical in shape to one created via the manual editor.
    (catalogue.fields || []).forEach((field) => {
        if (!field || !field.name) return;
        if (field.type === 'filter') return; // filterData handled below
        if (field.disabled || field.hidden) {
            cardData[field.name] = field.value;
            return;
        }
        const resolved = validateField(field, aiCardData[field.name], ctx);
        if (resolved !== undefined) cardData[field.name] = resolved;
    });

    // Final fieldName sanity — required across every card.
    if (!cardData.fieldName || typeof cardData.fieldName !== 'string' || cardData.fieldName.trim().length < 3) {
        cardData.fieldName = catalogue.fields?.find((f) => f.name === 'fieldName')?.value
            || t('AICard.fallback_card_name');
    }

    // filterData — keep only filter rows with a recognised filterOn and
    // a non-empty value list (mirrors the manual flow).
    let filterData = Array.isArray(parsed.filterData) ? parsed.filterData : [];
    filterData = filterData
        .filter((row) => row && VALID_FILTER_FIELDS.includes(row.filterOn))
        .map((row) => ({
            filterOn: row.filterOn,
            operator: row.operator || 'in',
            value: row.value !== undefined ? row.value : [],
            comparisonsData: Array.isArray(row.comparisonsData) ? row.comparisonsData : []
        }))
        .filter((row) => row.comparisonsData.length > 0);

    const projectNames = (cardData.projectId || [])
        .map((id) => (props.allProjectsArray || []).find((p) => p._id === id)?.ProjectName)
        .filter(Boolean);

    return {
        componentId: catalogue.key,
        cardId: catalogue._id,
        cardData,
        filterData,
        _cardTypeLabel: t(catalogue.name) || catalogue.key,
        _projectNames: projectNames
    };
}

async function generateCard() {
    if (!canGenerate.value || isGenerating.value) return;
    error.value = null;
    generatedCard.value = null;

    // Plan check — mirrors aiHelper.js but without the broken composable chain.
    if (!selectedCompany.value?.planFeature?.aiPermission) {
        Swal.fire({
            title: t('AI.please_upgrade_plan_to_use_ai'),
            text: t('AI.ai_available_on_paid_plans_upgrade_now'),
            icon: 'info',
            confirmButtonColor: '#28C76F',
            confirmButtonText: t('Header.upgrade_now'),
            showCloseButton: true
        }).then((result) => {
            if (result.isConfirmed) {
                router.push({ name: 'Upgrade', params: { cid: companyId.value } });
            }
        });
        return;
    }

    isGenerating.value = true;
    try {
        // Build the prompt fields that the backend will substitute into the
        // template at utils/aiPrompts.json#67ff000000000000aicard001.
        const fields = [
            { key: 'USER_REQUEST', value: userPrompt.value.trim() },
            { key: 'CARD_CATALOGUE', value: buildCatalogueSummary() },
            { key: 'USER_CONTEXT', value: buildUserContext() }
        ];
        const apiObj = {
            prompt: { id: DASHBOARD_CARD_PROMPT_ID, fields },
            uniqueUserId: `${userId.value}${makeUniqueId(6)}`,
            isRegenerate: false,
            companyId: companyId.value,
            userId: userId.value
        };
        let result;
        try {
            result = await apiRequest('post', '/api/v1/generatePrompt', apiObj);
        } catch (netErr) {
            console.error('AICardSidebar: /api/v1/generatePrompt request failed', netErr);
            error.value = t('AICard.error_engine');
            isGenerating.value = false;
            return;
        }
        // Backend shape: { status: true, statusText: '<AI text>', userUpdate }
        // or { status: true, statusText: '...', isNotAi: true } when AI_API_KEY
        // is missing, or { status: false, statusText: <error> } on failure.
        const body = result?.data || {};
        if (body.isNotAi) {
            $toast.error(body.statusText || t('AI.ai_not_integrated'), { position: 'top-right' });
            isGenerating.value = false;
            return;
        }
        if (body.status !== true || typeof body.statusText !== 'string') {
            console.error('AICardSidebar: backend rejected the AI call', body);
            error.value = t('AICard.error_engine');
            isGenerating.value = false;
            return;
        }
        const parsed = parseAiResponse(body.statusText);
        const resolved = validateAndResolve(parsed);
        if (resolved) generatedCard.value = resolved;
        isGenerating.value = false;
    } catch (e) {
        console.error('AICardSidebar.generateCard failed:', e);
        error.value = t('AICard.error_engine');
        isGenerating.value = false;
    }
}

function commit() {
    if (!generatedCard.value) return;
    emit('card-generated', {
        componentId: generatedCard.value.componentId,
        cardId: generatedCard.value.cardId,
        cardData: generatedCard.value.cardData,
        filterData: generatedCard.value.filterData
    });
    // Close + reset for next time. Parent persists the card.
    closeAndReset();
}

function reset() {
    generatedCard.value = null;
    error.value = null;
}

function closeAndReset() {
    userPrompt.value = '';
    generatedCard.value = null;
    error.value = null;
    isGenerating.value = false;
    emit('update:visible', false);
}
</script>

<style scoped>
/* ---------- Layout ---------- */
.ai-card-sidebar {
    padding: 20px 22px 28px;
    color: #111827;
}

.ai-card-section {
    margin-bottom: 12px;
}
.ai-card-section-title {
    margin: 0 0 4px 0;
    font-size: 13px;
    font-weight: 600;
    color: #111827;
    letter-spacing: 0.01em;
}
.ai-card-section-hint {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: #6b7280;
}
.mb-12px { margin-bottom: 12px; }

/* ---------- Textarea + meta row ---------- */
.ai-card-textarea {
    width: 100%;
    min-height: 120px;
    resize: vertical;
    padding: 12px 14px;
    font-size: 14px;
    line-height: 1.5;
    color: #111827;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    outline: none;
    font-family: inherit;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    box-sizing: border-box;
}
.ai-card-textarea::placeholder {
    color: #9ca3af;
}
.ai-card-textarea:focus {
    border-color: #4f46e5;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}

.ai-card-textarea-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 6px;
    margin-bottom: 22px;
    font-size: 11px;
    color: #9ca3af;
    min-height: 16px;
}
.ai-card-helper {
    transition: color 0.15s ease;
}
.ai-card-helper-warn {
    color: #d97706;
    font-weight: 500;
}
.ai-card-counter {
    font-variant-numeric: tabular-nums;
}

/* ---------- Chips ---------- */
.ai-card-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
    margin-bottom: 24px;
}
.ai-card-chip {
    background: #f3f4f6;
    border: 1px solid transparent;
    color: #374151;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    font-family: inherit;
    line-height: 1.2;
}
.ai-card-chip:hover {
    background: #eef2ff;
    color: #4338ca;
    border-color: #c7d2fe;
}
.ai-card-chip:active {
    background: #e0e7ff;
}

/* ---------- Buttons ---------- */
.ai-card-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 8px;
}
.ai-card-btn-primary,
.ai-card-btn-secondary {
    padding: 9px 20px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
}
.ai-card-btn-primary {
    background: #4f46e5;
    color: #fff;
    border: 1px solid #4f46e5;
}
.ai-card-btn-primary:hover:not(:disabled) {
    background: #4338ca;
    border-color: #4338ca;
}
.ai-card-btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.ai-card-btn-secondary {
    background: #fff;
    color: #4f46e5;
    border: 1px solid #c7d2fe;
}
.ai-card-btn-secondary:hover {
    background: #f5f3ff;
}

/* ---------- Loading ---------- */
.ai-card-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 240px;
    padding: 40px 20px;
}
.ai-card-loading-text {
    margin-top: 16px;
    font-size: 13px;
    color: #6b7280;
}

/* ---------- Preview ---------- */
.ai-card-preview {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 18px;
    margin-bottom: 20px;
}
.ai-card-preview-list {
    margin: 0;
}
.ai-card-preview-row {
    display: flex;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid #f3f4f6;
    font-size: 13px;
}
.ai-card-preview-row:last-child {
    border-bottom: none;
}
.ai-card-preview-row dt {
    flex: 0 0 96px;
    color: #6b7280;
    font-weight: 500;
    margin: 0;
}
.ai-card-preview-row dd {
    flex: 1;
    color: #111827;
    margin: 0;
    word-break: break-word;
}
.ai-card-filter-tag {
    display: inline-block;
    background: #ede9fe;
    color: #5b21b6;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    margin-right: 6px;
    margin-bottom: 4px;
}

/* ---------- Error ---------- */
.ai-card-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 10px;
    padding: 14px 16px;
    margin-bottom: 20px;
}
.ai-card-error-heading {
    color: #b91c1c;
    display: block;
    font-size: 13px;
    margin-bottom: 4px;
    font-weight: 600;
}
.ai-card-error-text {
    margin: 0;
    color: #7f1d1d;
    font-size: 13px;
    line-height: 1.5;
}

/* ---------- Mobile ---------- */
@media (max-width: 767px) {
    .ai-card-sidebar {
        padding: 16px 16px 24px;
    }
    .ai-card-textarea {
        min-height: 100px;
        font-size: 16px; /* prevent iOS Safari zoom-on-focus */
    }
    .ai-card-actions {
        flex-direction: column-reverse;
    }
    .ai-card-actions .ai-card-btn-primary,
    .ai-card-actions .ai-card-btn-secondary {
        width: 100%;
    }
}
</style>

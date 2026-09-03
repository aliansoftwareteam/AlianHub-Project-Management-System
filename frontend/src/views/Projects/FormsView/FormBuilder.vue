<template>
    <div class="fb">
        <div class="fb__bar">
            <button
                v-for="tab in TABS"
                :key="tab"
                type="button"
                class="fb__tab"
                :class="{ 'is-on': view === tab && !showSubmissions }"
                @click="setView(tab)"
            >{{ $t(`Projects.form_tab_${tab}`) }}</button>
            <button
                type="button"
                class="fb__tab"
                :class="{ 'is-on': showSubmissions }"
                @click="emit('update:showSubmissions', true)"
            >
                {{ $t('Projects.form_view_submissions') }}
                <span v-if="form.submissionCount" class="ah-mono fb__tab-count">{{ form.submissionCount }}</span>
            </button>

            <div class="ah-toolbar__spacer"></div>
            <a v-if="publicUrl" class="ah-btn ah-btn--ghost ah-btn--sm" :href="publicUrl" target="_blank" rel="noopener">
                {{ $t('Projects.form_open') }}
            </a>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" :disabled="busy" @click="askDelete">
                {{ $t('Projects.form_delete') }}
            </button>
            <button type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy || !dirty" @click="save">
                {{ busy ? '…' : (dirty ? $t('Projects.form_save') : $t('Projects.form_saved')) }}
            </button>
            <button v-if="form.state !== 'live'" type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="busy" @click="publish(true)">
                {{ busy ? '…' : $t('Projects.form_publish') }}
            </button>
            <button v-else type="button" class="ah-btn ah-btn--secondary ah-btn--sm" :disabled="busy" @click="publish(false)">
                {{ $t('Projects.form_unpublish') }}
            </button>
        </div>

        <div v-if="err" class="ah-field__error fb__err">{{ err }}</div>
        <!-- Saving in this state is refused by the server, because a live form
             whose task name is missing rejects every submission. Offered here with
             the fix attached, rather than after a failed save. -->
        <div v-else-if="needsTaskName" class="fb__warn">
            <span>{{ $t('Projects.form_needs_task_name') }}</span>
            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="settings.createTask = false">
                {{ $t('Projects.form_turn_off_tasks') }}
            </button>
        </div>

        <div v-if="showSubmissions" class="fb__submissions">
            <FormSubmissions :formId="String(form._id)" :formTitle="form.title || ''" />
        </div>

        <div v-else-if="isMobile" class="fb__mobile">
            <div class="ah-empty fb__mobile-card">
                <div class="fb__mobile-title">{{ $t('ViewsV2.desktop_only_title') }}</div>
                <p class="fb__mobile-text">{{ $t('ViewsV2.desktop_only_forms') }}</p>
            </div>
        </div>

        <div v-else class="fb__body">
            <aside class="fb__palette ah-scroll">
                <input v-model="search" class="ah-input fb__search" :placeholder="$t('Projects.search')" />
                <div class="ah-label fb__palette-head">{{ $t('ViewsV2.fields_drag_in') }}</div>
                <div class="fb__types">
                    <button
                        v-for="c in paletteTypes"
                        :key="c.type"
                        type="button"
                        class="fb__type"
                        draggable="true"
                        @dragstart="dragItem = { type: c.type, label: c.title }"
                        @dragend="dragItem = null"
                        @click="addQuestion({ type: c.type, label: c.title })"
                    >{{ c.title }}</button>
                </div>
                <template v-if="settings.createTask && paletteProps.length">
                    <div class="ah-label fb__palette-head">{{ $t('ViewsV2.task_properties') }}</div>
                    <div class="fb__props">
                        <button
                            v-for="p in paletteProps"
                            :key="p.property"
                            type="button"
                            class="fb__prop"
                            :disabled="usedProperty(p.property)"
                            draggable="true"
                            @dragstart="dragItem = { mapTo: p.property, label: p.title }"
                            @dragend="dragItem = null"
                            @click="addQuestion({ mapTo: p.property, label: p.title })"
                        >{{ p.title }}</button>
                    </div>
                </template>
                <p class="fb__palette-note ah-small">{{ $t('ViewsV2.mapped_fields_note') }}</p>
            </aside>

            <div class="fb__canvas-wrap ah-scroll">
                <div class="fb__canvas" :class="{ 'fb__canvas--preview': view === 'preview' }">
                    <div class="fb__head" :class="headClass">
                        <h2 class="fb__title">{{ form.title }}</h2>
                        <p v-if="form.description" class="fb__desc">{{ form.description }}</p>
                    </div>

                    <template v-if="view === 'preview'">
                        <div class="fb__grid">
                            <div v-for="q in visible" :key="q.id" class="fb__cell" :class="spanClass(q)">
                                <FormField :question="q" :type="typeMeta(q.type)" live />
                            </div>
                        </div>
                        <button type="button" class="fb__submit" :style="{ background: settings.buttonColor }" disabled>
                            {{ $t('Projects.form_submit') }}
                        </button>
                    </template>

                    <template v-else>
                        <div v-if="!questions.length" class="fb__empty">{{ $t('Projects.form_no_questions') }}</div>
                        <draggable
                            v-model="questions"
                            tag="div"
                            class="fb__grid fb__grid--build"
                            item-key="id"
                            handle=".fb__grip"
                            ghost-class="fb__cell--ghost"
                            :animation="150"
                        >
                            <!-- Exactly ONE node may live in #item: vuedraggable counts a
                                 comment as a child too, so notes belong out here. An open
                                 question takes the full row, since a quarter-width editor
                                 card is unusable. -->
                            <template #item="{ element: q, index: i }">
                                <div class="fb__cell" :class="open === q.id ? 'fb__cell--s12' : spanClass(q)">
                                    <div v-if="open !== q.id" class="fb__peek" :class="{ 'is-hidden': q.hidden }" @click="open = q.id">
                                        <div class="fb__peek-top">
                                            <span class="fb__grip" :title="$t('Projects.form_drag_to_reorder')" @click.stop>
                                                <img :src="dragDots" alt="" />
                                            </span>
                                            <span v-if="q.required" class="fb__req">{{ $t('Projects.form_required') }}</span>
                                            <span class="fb__map" :class="{ 'is-mapped': !!q.mapTo }">→ {{ chip(q) }}</span>
                                        </div>
                                        <FormField :question="q" :type="typeMeta(q.type)" />
                                    </div>

                                    <div v-else class="fb__card">
                                        <div class="fb__card-top">
                                            <span class="fb__grip fb__grip--inline" :title="$t('Projects.form_drag_to_reorder')">
                                                <img :src="dragDots" alt="" />
                                            </span>
                                            <span class="fb__map" :class="{ 'is-mapped': !!q.mapTo }">→ {{ chip(q) }}</span>
                                            <div class="fb__tools">
                                                <button type="button" :class="{ 'is-on': q.hidden }" :title="$t('Projects.form_hide')" @click="q.hidden = !q.hidden">
                                                    <FormIcon :name="q.hidden ? 'eye-off' : 'eye'" />
                                                </button>
                                                <!-- A trash, not an X: an X in this corner reads as "close the
                                                     editor", and this button deletes the question. -->
                                                <button type="button" class="fb__del" :title="$t('Projects.form_remove_question')" @click="remove(i)">
                                                    <FormIcon name="trash" />
                                                </button>
                                                <button type="button" :title="$t('Projects.form_close_edit')" @click="open = ''">
                                                    <FormIcon name="close" />
                                                </button>
                                            </div>
                                        </div>

                                        <input v-model="q.label" class="ah-input fb__label-in" :placeholder="$t('Projects.form_question_label')" />
                                        <input v-model="q.help" class="ah-input fb__help-in" :placeholder="$t('Projects.form_question_help')" />

                                        <FormField :question="q" :type="typeMeta(q.type)" />

                                        <div v-if="typeMeta(q.type).options && !q.mapTo" class="fb__options">
                                            <div v-for="(o, oi) in q.options" :key="o.id" class="fb__option">
                                                <input v-model="o.label" class="ah-input fb__opt-in" :placeholder="$t('Projects.form_option')" />
                                                <button type="button" :disabled="q.options.length < 2" @click="q.options.splice(oi, 1)">
                                                    <FormIcon name="close" />
                                                </button>
                                            </div>
                                            <button type="button" class="fb__opt-add" @click="addOption(q)">
                                                + {{ $t('Projects.form_add_option') }}
                                            </button>
                                        </div>

                                        <label v-if="q.type === 'rating'" class="fb__scale">
                                            {{ $t('Projects.form_scale') }}
                                            <input v-model.number="q.max" type="number" min="2" max="10" />
                                        </label>

                                        <div class="fb__widths">
                                            <span class="fb__widths-label">{{ $t('Projects.form_width') }}</span>
                                            <button
                                                v-for="w in SPANS"
                                                :key="w"
                                                type="button"
                                                class="fb__width"
                                                :class="{ 'is-on': (q.span || 12) === w }"
                                                @click="q.span = w"
                                            >{{ $t(`Projects.form_width_${w}`) }}</button>
                                        </div>

                                        <div class="fb__card-foot">
                                            <label v-if="typeMeta(q.type).widget !== 'info'" class="ah-check fb__check">
                                                <input v-model="q.required" type="checkbox" />
                                                <span>{{ $t('Projects.form_required') }}</span>
                                            </label>
                                            <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="open = ''">{{ $t('Projects.form_done') }}</button>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </draggable>

                        <div
                            class="fb__drop"
                            :class="{ 'is-over': dropActive }"
                            @dragover.prevent="dropActive = true"
                            @dragleave="dropActive = false"
                            @drop.prevent="dropField"
                        >{{ $t('ViewsV2.drop_field_here') }}</div>
                    </template>
                </div>
            </div>

            <aside class="fb__side ah-scroll">
                <div class="fb__side-title">{{ $t('ViewsV2.on_submit') }}</div>
                <label class="ah-check fb__rule">
                    <input v-model="settings.createTask" type="checkbox" />
                    <span>{{ $t('Projects.form_create_task') }}</span>
                </label>
                <template v-if="settings.createTask">
                    <div class="fb__rule fb__rule--field">
                        <span class="fb__rule-label">{{ $t('Projects.form_target_sprint') }}</span>
                        <select v-model="sprintId" class="ah-input fb__select">
                            <option value="">{{ $t('Projects.form_pick_sprint') }}</option>
                            <option v-for="s in sprints" :key="s.id" :value="s.id">{{ s.name }}</option>
                        </select>
                    </div>
                    <div class="fb__rule fb__rule--field">
                        <span class="fb__rule-label">{{ $t('Projects.form_task_type') }}</span>
                        <select v-model="taskTypeKey" class="ah-input fb__select">
                            <option value="">{{ $t('Projects.form_default_task_type') }}</option>
                            <option v-for="tt in taskTypes" :key="tt.key" :value="tt.key">{{ tt.name }}</option>
                        </select>
                    </div>
                </template>
                <label v-for="tog in TOGGLES" :key="tog" class="ah-check fb__rule">
                    <input v-model="settings[tog]" type="checkbox" />
                    <span>{{ $t(`Projects.form_${tog}`) }}</span>
                </label>

                <div class="fb__side-title fb__side-title--sub">{{ $t('GapsV2.on_submit_rules') }}</div>
                <div v-for="rule in submitRules" :key="rule._id" class="fb__rule fb__rule--auto">
                    <span class="ah-dot" :class="rule.enabled ? 'ah-dot--ok' : ''"></span>
                    <span class="fb__rule-name" :title="rule.summary || rule.name">{{ rule.summary || rule.name }}</span>
                    <button type="button" class="fb__rule-btn" @click="toggleRule(rule)">
                        {{ rule.enabled ? $t('GapsV2.submit_rule_on') : $t('GapsV2.submit_rule_off') }}
                    </button>
                    <button type="button" class="fb__rule-btn fb__rule-btn--danger" @click="removeRule(rule)">
                        {{ $t('GapsV2.submit_rule_remove') }}
                    </button>
                </div>
                <p v-if="!submitRules.length && !draft" class="ah-small fb__side-note">{{ $t('GapsV2.no_submit_rules_v2') }}</p>

                <div v-if="draft" class="fb__rule fb__rule--field">
                    <span class="fb__rule-label">{{ $t('GapsV2.submit_rule_when') }}</span>
                    <select v-model="draft.questionId" class="ah-input fb__select">
                        <option value="">{{ $t('GapsV2.submit_rule_any') }}</option>
                        <option v-for="q in visible" :key="q.id" :value="q.id">{{ q.label }}</option>
                    </select>
                    <template v-if="draft.questionId">
                        <span class="fb__rule-label">{{ $t('GapsV2.submit_rule_is') }}</span>
                        <input v-model="draft.answer" class="ah-input" type="text" :placeholder="$t('GapsV2.submit_rule_value')" />
                    </template>
                    <span class="fb__rule-label">{{ $t('GapsV2.submit_rule_then') }}</span>
                    <select v-model="draft.action" class="ah-input fb__select">
                        <option v-for="a in ruleActions" :key="a.key" :value="a.key">{{ a.label }}</option>
                    </select>
                    <select v-if="draftOptions.length" v-model="draft.value" class="ah-input fb__select">
                        <option v-for="opt in draftOptions" :key="opt" :value="opt">{{ opt }}</option>
                    </select>
                    <input v-else v-model="draft.value" class="ah-input" type="text" :placeholder="$t('GapsV2.submit_rule_value')" />
                    <p v-if="ruleErr" class="ah-field__error">{{ ruleErr }}</p>
                    <div class="fb__rule-actions">
                        <button type="button" class="ah-btn ah-btn--primary ah-btn--sm" :disabled="ruleBusy" @click="saveRule">{{ $t('GapsV2.submit_rule_save') }}</button>
                        <button type="button" class="ah-btn ah-btn--ghost ah-btn--sm" @click="draft = null">{{ $t('GapsV2.submit_rule_cancel') }}</button>
                    </div>
                </div>
                <button v-else-if="canAddRule" type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="startRule">{{ $t('GapsV2.add_submit_rule') }}</button>
                <p v-else class="ah-small fb__side-note">{{ ruleBlockedReason }}</p>

                <router-link class="fb__side-link" :to="{ name: 'Automations', params: { cid: companyId } }">{{ $t('ViewsV2.open_automations') }}</router-link>

                <div class="fb__side-title fb__side-title--sub">{{ $t('ViewsV2.sharing') }}</div>
                <div v-if="publicUrl" class="fb__url">
                    <span class="fb__url-text">{{ publicUrl }}</span>
                    <button type="button" class="fb__url-copy" @click="copyUrl">{{ copied ? $t('ViewsV2.copied') : $t('ViewsV2.copy') }}</button>
                </div>
                <p class="ah-small fb__side-note">{{ publicUrl ? $t('ViewsV2.share_note') : $t('ViewsV2.publish_to_share') }}</p>

                <div v-if="form.submissionCount" class="fb__stats">
                    {{ $t('ViewsV2.submission_count', { n: form.submissionCount }) }}
                </div>

                <div class="fb__side-title fb__side-title--sub">{{ $t('Projects.form_colors') }}</div>
                <div class="fb__aligns">
                    <button
                        v-for="a in ALIGNMENTS"
                        :key="a"
                        type="button"
                        class="fb__align"
                        :class="{ 'is-on': settings.titleAlign === a }"
                        :title="$t(`Projects.form_align_${a}`)"
                        @click="settings.titleAlign = a"
                    ><FormIcon :name="`align-${a}`" /></button>
                    <label class="ah-check fb__rule fb__rule--inline">
                        <input v-model="settings.titleDivider" type="checkbox" />
                        <span>{{ $t('Projects.form_title_divider') }}</span>
                    </label>
                </div>
                <div class="fb__themes">
                    <button
                        v-for="th in THEMES"
                        :key="th"
                        type="button"
                        class="fb__theme"
                        :class="{ 'is-on': settings.theme === th }"
                        @click="settings.theme = th"
                    >{{ $t(`Projects.form_theme_${th}`) }}</button>
                </div>
                <div class="ah-label fb__swatch-label">{{ $t('Projects.form_background') }}</div>
                <div class="fb__swatches">
                    <button
                        v-for="c in BACKGROUNDS"
                        :key="c"
                        type="button"
                        class="fb__swatch"
                        :class="{ 'is-on': settings.background === c }"
                        :style="{ background: c }"
                        :aria-label="c"
                        @click="settings.background = c"
                    ></button>
                </div>
                <div class="ah-label fb__swatch-label">{{ $t('Projects.form_button_color') }}</div>
                <div class="fb__swatches">
                    <button
                        v-for="c in BUTTON_COLORS"
                        :key="c"
                        type="button"
                        class="fb__swatch"
                        :class="{ 'is-on': settings.buttonColor === c }"
                        :style="{ background: c }"
                        :aria-label="c"
                        @click="settings.buttonColor = c"
                    ></button>
                </div>
            </aside>
        </div>

        <ConfirmDelete
            v-if="confirming"
            :title="$t('Projects.form_delete_title', { title: form.title || '' })"
            :description="$t('Projects.form_delete_desc')"
            :confirm-label="$t('Projects.form_delete')"
            :busy="busy"
            @cancel="confirming = false"
            @confirm="destroy"
        />
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import * as env from '@/config/env';
import { useToast } from 'vue-toast-notification';
import FormField from './FormField.vue';
import FormIcon from './FormIcon.vue';
import FormSubmissions from './FormSubmissions.vue';
import ConfirmDelete from '@/components/atom/ConfirmDelete/ConfirmDelete.vue';
import draggable from 'vuedraggable';
import dragDots from '@/assets/images/svg/drag_dots.svg';

defineOptions({ name: 'FormBuilder' });

const { t } = useI18n();
const toast = useToast();
const clientWidth = inject('$clientWidth', ref(1440));
const companyId = inject('$companyId', ref(''));
const props = defineProps({
    form: { type: Object, required: true },
    projectData: { type: Object, default: () => ({}) },
    // The title is edited in the header above this component, but it is saved by
    // the same button, so it travels in the same request.
    titleDraft: { type: String, default: null },
    // The control that opens the response table sits in the header above this
    // component, so the state is owned there and mirrored here.
    showSubmissions: { type: Boolean, default: false },
});
const emit = defineEmits(['saved', 'deleted', 'dirty', 'update:showSubmissions']);

// Settings has no tab of its own: its panel sits beside the canvas while you
// build, which is where the choices it holds are actually visible.
const TABS = ['build', 'preview'];
const THEMES = ['light', 'dark'];
const TOGGLES = ['answersInDescription', 'hideBranding'];
const ALIGNMENTS = ['left', 'center', 'right'];
const BACKGROUNDS = ['#f5f6fa', '#ffffff', '#eef2ff', '#eefaf3', '#fff7e6', '#fdeef1', '#f3eefa', '#1f2130'];
const BUTTON_COLORS = ['#2f3a8f', '#4b5563', '#6473e8', '#2f80ed', '#24c110', '#f5a623', '#ec4141', '#9759c0'];

const view = ref('build');
// Picking a tab is also the way back out of the response table, so the header
// button follows along.
const setView = (tab) => {
    view.value = tab;
    if (props.showSubmissions) emit('update:showSubmissions', false);
};
const questions = ref([]);
const sprintId = ref('');
const taskTypeKey = ref('');
const settings = ref({});
const groups = ref([]);
const publicUrl = ref('');
const busy = ref(false);
const err = ref('');
const open = ref('');
const search = ref('');
const dragItem = ref(null);
const dropActive = ref(false);
const copied = ref(false);
const submitRules = ref([]);

const isMobile = computed(() => Number(clientWidth?.value || 0) > 0 && Number(clientWidth.value) < 768);

// Titles for the chip; the widget each type renders as comes from the same table
// the server validates against, sent alongside the menu.
const typeTitles = computed(() => {
    const out = {};
    for (const g of groups.value) for (const c of g.create) out[c.type] = c.title;
    return out;
});
const widgets = ref({});
const typeMeta = (type) => widgets.value[type] || { widget: 'text' };

const visible = computed(() => questions.value.filter((q) => !q.hidden));

// Widths come back from the server already resolved, so there is no fallback rule
// here to drift from the one the public page uses.
const SPANS = [12, 6, 4, 3];
const spanClass = (q) => `fb__cell--s${SPANS.includes(Number(q.span)) ? Number(q.span) : 12}`;
const headClass = computed(() => [
    `fb__head--${ALIGNMENTS.includes(settings.value.titleAlign) ? settings.value.titleAlign : 'left'}`,
    settings.value.titleDivider ? 'fb__head--rule' : '',
]);
// What a newly added question starts at. `settings.layout` is no longer a control
// — widths are per question — but it survives as the width a question falls back
// to when it has none of its own, which is what keeps older forms unchanged.
const defaultSpan = (type) => (['textarea', 'info'].includes(typeMeta(type).widget)
    ? 12
    : (settings.value.layout === 'two' ? 6 : 12));

// A form that files tasks must name them. Surfaced as soon as the mapping is
// gone, since the save that would carry it is refused.
const needsTaskName = computed(() => settings.value.createTask
    && questions.value.length > 0
    && !questions.value.some((q) => q.mapTo === 'TaskName'));

const matches = (title) => {
    const term = search.value.trim().toLowerCase();
    return !term || String(title || '').toLowerCase().includes(term);
};
const paletteTypes = computed(() => groups.value.flatMap((g) => g.create).filter((c) => matches(c.title)));
const paletteProps = computed(() => groups.value.flatMap((g) => g.mapTo).filter((p) => matches(p.title)));

const chip = (q) => {
    if (q.mapTo) {
        for (const g of groups.value) {
            const hit = g.mapTo.find((m) => m.property === q.mapTo);
            if (hit) return hit.title;
        }
        return q.mapTo;
    }
    return typeTitles.value[q.type] || q.type;
};
const usedProperty = (property) => questions.value.some((q) => q.mapTo === property);

// Sprints of THIS project only. A form filing into another project's sprint is
// refused on publish, so offering one here would only produce a dead end.
const sprints = computed(() => {
    const p = props.projectData || {};
    const out = [];
    const add = (obj, prefix) => {
        for (const key of Object.keys(obj || {})) {
            const s = obj[key];
            if (!s || s.deletedStatusKey === 1) continue;
            out.push({ id: String(s.id || s._id || key), name: prefix ? `${prefix} / ${s.name || 'Sprint'}` : (s.name || 'Sprint') });
        }
    };
    add(p.sprintsObj);
    for (const fid of Object.keys(p.sprintsfolders || {})) {
        const folder = p.sprintsfolders[fid] || {};
        add(folder.sprintsObj, folder.name || '');
    }
    return out;
});

// Submissions become tasks, so the type has to be one this project has
// configured; an empty choice leaves the server to take the project's first.
const taskTypes = computed(() => (Array.isArray(props.projectData && props.projectData.taskTypeCounts)
    ? props.projectData.taskTypeCounts : [])
    .filter((tt) => tt && tt.key !== undefined)
    .map((tt) => ({ key: String(tt.key), name: tt.name || tt.value || '' })));

const hydrate = () => {
    questions.value = (props.form.questions || [])
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((q) => ({ options: [], ...JSON.parse(JSON.stringify(q)) }));
    sprintId.value = props.form.sprintId ? String(props.form.sprintId) : '';
    const d = props.form.defaults || {};
    taskTypeKey.value = d.taskTypeKey === undefined || d.taskTypeKey === null ? '' : String(d.taskTypeKey);
    settings.value = {
        createTask: true,
        titleAlign: 'left', titleDivider: true,
        layout: 'two', theme: 'light', background: '#f5f6fa', buttonColor: '#2f3a8f',
        answersInDescription: true, hideBranding: false,
        ...(props.form.settings || {}),
    };
    // Read from the form itself, not only from the reply to Publish, so the
    // open-form link is still there after a reload.
    publicUrl.value = props.form.url || '';
    open.value = '';
    baseline.value = JSON.stringify(payload());
};

const loadCatalogue = async () => {
    try {
        const body = (await apiRequest('get', '/api/v2/forms/fields'))?.data;
        groups.value = (body && body.status && body.data && body.data.groups) || [];
        widgets.value = (body && body.status && body.data && body.data.widgets) || {};
    } catch (e) { groups.value = []; }
};

/* What actually runs after a submission. These are real automation rules on the
 * `form.submitted` trigger, bound to this form by a `formId` condition — the
 * same documents the Automations screen edits, so a rule made here is not a
 * second kind of rule. */
const SUBMIT_TRIGGER = 'form.submitted';
const RULE_ACTION_KEYS = ['set_priority', 'set_status', 'add_comment'];

const registryActions = ref([]);
const draft = ref(null);
const ruleErr = ref('');
const ruleBusy = ref(false);

const ruleActions = computed(() => registryActions.value.filter((a) => RULE_ACTION_KEYS.includes(a.key)));

const projectStatusNames = computed(() => (Array.isArray(props.projectData?.taskStatusData)
    ? props.projectData.taskStatusData.map((s) => String(s?.name || '')).filter(Boolean)
    : []));

/* The value control follows the action's own schema, so a new action needs no
 * case added here — a select when the schema names its options, a box when not. */
const draftOptions = computed(() => {
    if (!draft.value) return [];
    const action = ruleActions.value.find((a) => a.key === draft.value.action);
    const spec = action && action.schema ? Object.values(action.schema)[0] : null;
    if (spec && Array.isArray(spec.options)) return spec.options;
    if (draft.value.action === 'set_status') return projectStatusNames.value;
    return [];
});

const canAddRule = computed(() => !!props.form._id && !!props.projectData?._id && settings.value.createTask !== false);
const ruleBlockedReason = computed(() => {
    if (!props.projectData?._id) return t('GapsV2.submit_rule_needs_project');
    if (settings.value.createTask === false) return t('GapsV2.submit_rule_needs_task');
    return t('ViewsV2.publish_to_share');
});

const bindsToThisForm = (rule) => {
    const id = String(props.form._id || '');
    if (!id) return false;
    const args = Array.isArray(rule?.conditions?.args) ? rule.conditions.args : [rule?.conditions];
    return args.some((a) => a && a.field === 'formId' && String(a.value) === id);
};

const loadSubmitRules = async () => {
    try {
        const body = (await apiRequest('get', env.AUTOMATIONS_V2))?.data;
        const rows = (body && body.status && Array.isArray(body.data)) ? body.data : [];
        submitRules.value = rows.filter((r) => String(r.trigger?.event || '') === SUBMIT_TRIGGER && bindsToThisForm(r));
    } catch (e) { submitRules.value = []; }
};

const loadRegistry = async () => {
    try {
        const body = (await apiRequest('get', `${env.AUTOMATIONS_V2}/registry`))?.data;
        registryActions.value = (body && body.status && body.data && body.data.actions) || [];
    } catch (e) { registryActions.value = []; }
};

const startRule = () => {
    ruleErr.value = '';
    draft.value = { questionId: '', answer: '', action: ruleActions.value[0]?.key || 'set_priority', value: '' };
};

const buildConditions = () => {
    const args = [{ op: 'eq', field: 'formId', value: String(props.form._id) }];
    if (draft.value.questionId) {
        args.push({ op: 'eq', field: `answers.${draft.value.questionId}`, value: String(draft.value.answer || '') });
    }
    return { op: 'and', args };
};

const configFor = (actionKey, value) => {
    const action = ruleActions.value.find((a) => a.key === actionKey);
    const field = action && action.schema ? Object.keys(action.schema)[0] : 'value';
    return { [field]: value };
};

const saveRule = async () => {
    if (!draft.value) return;
    ruleErr.value = '';
    if (!String(draft.value.value || '').trim()) {
        ruleErr.value = t('GapsV2.submit_rule_value');
        return;
    }
    ruleBusy.value = true;
    try {
        const label = ruleActions.value.find((a) => a.key === draft.value.action)?.label || draft.value.action;
        const body = (await apiRequest('post', env.AUTOMATIONS_V2, {
            name: t('GapsV2.submit_rule_name', { action: label }),
            trigger: { type: 'event', event: SUBMIT_TRIGGER },
            scope: { allProjects: false, projectIds: [String(props.projectData._id)] },
            conditions: buildConditions(),
            steps: [{ id: 's1', type: 'action', action: draft.value.action, config: configFor(draft.value.action, draft.value.value) }],
            enabled: true,
        }))?.data;
        if (!body || body.status !== true) {
            ruleErr.value = (body && body.statusText) || t('GapsV2.submit_rule_failed');
            return;
        }
        draft.value = null;
        toast.success(t('GapsV2.submit_rule_saved'));
        await loadSubmitRules();
    } catch (e) {
        ruleErr.value = t('GapsV2.submit_rule_failed');
    } finally {
        ruleBusy.value = false;
    }
};

const toggleRule = async (rule) => {
    try {
        await apiRequest('patch', `${env.AUTOMATIONS_V2}/${rule._id}/enabled`, { enabled: !rule.enabled });
        await loadSubmitRules();
    } catch (e) { ruleErr.value = t('GapsV2.submit_rule_failed'); }
};

const removeRule = async (rule) => {
    try {
        await apiRequest('delete', `${env.AUTOMATIONS_V2}/${rule._id}`);
        await loadSubmitRules();
    } catch (e) { ruleErr.value = t('GapsV2.submit_rule_failed'); }
};

onMounted(() => { hydrate(); loadCatalogue(); loadRegistry(); loadSubmitRules(); });
watch(() => props.form._id, () => { hydrate(); draft.value = null; loadSubmitRules(); });

const addOption = (q) => {
    if (!Array.isArray(q.options)) q.options = [];
    q.options.push({ id: `o${q.options.length + 1}_${Date.now().toString(36)}`, label: `${t('Projects.form_option')} ${q.options.length + 1}` });
};

const addQuestion = ({ type, mapTo, label }) => {
    const q = {
        id: `q_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
        type: type || '',
        mapTo: mapTo || '',
        label,
        help: '',
        required: false,
        hidden: false,
        options: [],
    };
    if (!mapTo && typeMeta(type).options) {
        q.options = [1, 2].map((n) => ({ id: `o${n}`, label: `${t('Projects.form_option')} ${n}` }));
    }
    if (type === 'rating') q.max = 5;
    q.span = defaultSpan(q.type);
    questions.value.push(q);
    open.value = q.id;
};

const dropField = () => {
    dropActive.value = false;
    const item = dragItem.value;
    dragItem.value = null;
    if (!item) return;
    if (item.mapTo && usedProperty(item.mapTo)) return;
    addQuestion(item);
};

const remove = (i) => { questions.value.splice(i, 1); open.value = ''; };

const copyUrl = () => {
    if (!publicUrl.value || !navigator.clipboard) return;
    navigator.clipboard.writeText(publicUrl.value).then(() => {
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 2000);
    }).catch(() => { copied.value = false; });
};

/* Built in one place so the Save button's enabled state and what actually gets
 * sent can never disagree. */
const payload = () => ({
    ...(props.titleDraft === null ? {} : { title: props.titleDraft.trim() }),
    sprintId: sprintId.value || null,
    settings: { ...settings.value },
    // Merged, not replaced: the server stores defaults whole.
    defaults: Object.assign({}, props.form.defaults || {}, {
        taskTypeKey: taskTypeKey.value === '' ? null : Number(taskTypeKey.value),
    }),
    questions: questions.value.map((q, i) => ({
        id: q.id,
        type: q.type,
        mapTo: q.mapTo || '',
        label: q.label,
        help: q.help || '',
        required: q.required === true,
        hidden: q.hidden === true,
        options: Array.isArray(q.options) ? q.options : [],
        max: q.max,
        span: q.span,
        order: i + 1,
    })),
});

// Editing stays local until Save. Saving on change meant a request per edit, and
// every reply re-rendered the form list and the publish button.
const baseline = ref('');
const dirty = computed(() => baseline.value !== '' && JSON.stringify(payload()) !== baseline.value);
watch(dirty, (on) => emit('dirty', on));

const save = async () => {
    if (busy.value || !dirty.value) return true;
    busy.value = true; err.value = '';
    try {
        const body = (await apiRequest('put', `/api/v2/forms/${props.form._id}`, payload()))?.data;
        if (body && body.status) {
            baseline.value = JSON.stringify(payload());
            emit('saved', body.data);
            return true;
        }
        err.value = (body && body.statusText) || t('Toast.something_went_wrong');
    } catch (e) {
        err.value = (e && e.response && e.response.data && e.response.data.statusText) || (e && e.message) || t('Toast.something_went_wrong');
    } finally { busy.value = false; }
    return false;
};

const confirming = ref(false);

const askDelete = () => {
    // A published form has a link in circulation; deleting it would break that
    // link silently. The server refuses this too — this is the readable half, and
    // it stops before the confirmation rather than after it.
    if (props.form.state === 'live') {
        toast.warning(t('Projects.form_delete_live_blocked'), { position: 'top-right' });
        return;
    }
    confirming.value = true;
};

const destroy = async () => {
    if (busy.value) return;
    busy.value = true; err.value = '';
    try {
        const body = (await apiRequest('delete', `/api/v2/forms/${props.form._id}`))?.data;
        if (body && body.status) {
            confirming.value = false;
            toast.success(t('Projects.form_deleted'), { position: 'top-right' });
            emit('deleted', props.form._id);
        } else {
            const why = (body && body.statusText) || t('Toast.something_went_wrong');
            toast.error(why, { position: 'top-right' });
            err.value = why;
        }
    } catch (e) {
        const why = (e && e.response && e.response.data && e.response.data.statusText)
            || (e && e.message) || t('Toast.something_went_wrong');
        toast.error(why, { position: 'top-right' });
        err.value = why;
    } finally { busy.value = false; }
};

const publish = async (on) => {
    // Publish snapshots the form, so unsaved edits would be left out of it.
    if (dirty.value && !(await save())) return;
    busy.value = true; err.value = '';
    try {
        const body = (await apiRequest('post', `/api/v2/forms/${props.form._id}/publish`, { publish: on }))?.data;
        if (body && body.status) {
            publicUrl.value = (body.data && body.data.url) || '';
            emit('saved', body.data && body.data.form ? body.data.form : body.data);
        } else err.value = (body && body.statusText) || t('Toast.something_went_wrong');
    } catch (e) {
        err.value = (e && e.response && e.response.data && e.response.data.statusText) || (e && e.message) || t('Toast.something_went_wrong');
    } finally { busy.value = false; }
};
</script>

<style scoped src="./style.css"></style>

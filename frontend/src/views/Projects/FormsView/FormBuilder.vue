<template>
    <div class="fb">
        <!-- Form chrome: tabs, Save, Publish. None of it acts on the response
             table, which carries its own controls. -->
        <template v-if="!showSubmissions">
            <div class="fb__tabs">
                <button v-for="tab in TABS" :key="tab" type="button" class="fb__tab"
                    :class="{ 'is-on': view === tab }" @click="setView(tab)">
                    {{ $t(`Projects.form_tab_${tab}`) }}
                </button>
                <div class="fb__tabs-right">
                    <a v-if="publicUrl" class="fb__icon" :href="publicUrl" target="_blank" rel="noopener"
                        :title="$t('Projects.form_open')"><FormIcon name="external" /></a>
                    <button type="button" class="fb__icon fb__icon--del" :title="$t('Projects.form_delete')"
                        :disabled="busy" @click="askDelete"><FormIcon name="trash" /></button>
                    <button type="button" class="fb__btn" :class="{ 'fb__btn--dirty': dirty }"
                        :disabled="busy || !dirty" @click="save">
                        {{ busy ? '…' : (dirty ? $t('Projects.form_save') : $t('Projects.form_saved')) }}
                    </button>
                    <button v-if="form.state !== 'live'" type="button" class="fb__btn fb__btn--primary"
                        :disabled="busy" @click="publish(true)">
                        {{ busy ? '…' : $t('Projects.form_publish') }}
                    </button>
                    <button v-else type="button" class="fb__btn fb__btn--primary" :disabled="busy"
                        @click="publish(false)">
                        {{ $t('Projects.form_unpublish') }}
                    </button>
                </div>
            </div>

            <div v-if="err" class="fb__err">{{ err }}</div>

            <!-- Saving in this state is refused by the server, because a live form
                 whose task name is missing rejects every submission. Offered here with
                 the fix attached, rather than after a failed save. -->
            <div v-else-if="needsTaskName" class="fb__warn">
                <span>{{ $t('Projects.form_needs_task_name') }}</span>
                <button type="button" class="fb__warn-btn" @click="settings.createTask = false">
                    {{ $t('Projects.form_turn_off_tasks') }}
                </button>
            </div>
        </template>

        <div class="fb__body">
            <div v-if="showSubmissions" class="fb__wide">
                <FormSubmissions :formId="String(form._id)" :formTitle="form.title || ''" />
            </div>

            <div v-else class="fb__canvas" :class="{ 'fb__canvas--preview': view === 'preview' }">
                <div class="fb__head" :class="headClass">
                    <h2 class="fb__title">{{ form.title }}</h2>
                    <p v-if="form.description" class="fb__desc">{{ form.description }}</p>
                </div>

                <div v-if="view === 'preview'" class="fb__grid">
                    <div v-for="q in visible" :key="q.id" class="fb__cell" :class="spanClass(q)">
                        <FormField :question="q" :type="typeMeta(q.type)" live />
                    </div>
                </div>
                <button v-if="view === 'preview'" type="button" class="fb__submit"
                    :style="{ background: settings.buttonColor }" disabled>
                    {{ $t('Projects.form_submit') }}
                </button>

                <template v-else-if="view === 'build'">
                    <div v-if="!questions.length" class="fb__empty">{{ $t('Projects.form_no_questions') }}</div>
                    <draggable v-model="questions" tag="div" class="fb__grid fb__grid--build"
                        item-key="id" handle=".fb__grip" ghost-class="fb__cell--ghost" :animation="150">
                        <!-- Exactly ONE node may live in #item: vuedraggable counts a
                             comment as a child too, so notes belong out here. An open
                             question takes the full row, since a quarter-width editor
                             card is unusable. -->
                        <template #item="{ element: q, index: i }">
                            <div class="fb__cell" :class="open === q.id ? 'fb__cell--s12' : spanClass(q)">
                                <div v-if="open !== q.id" class="fb__peek" :class="{ 'is-hidden': q.hidden }"
                                    @click="open = q.id">
                                    <!-- Clicking the field itself already edits it; this makes that
                                         discoverable instead of something you have to try. -->
                                    <button type="button" class="fb__editcue" :title="$t('Projects.form_edit_question')"
                                        @click.stop="open = q.id">
                                        <FormIcon name="pencil" />
                                    </button>
                                    <!-- .stop so grabbing the grip does not also open the
                                         question the click would otherwise land on -->
                                    <span class="fb__grip" :title="$t('Projects.form_drag_to_reorder')"
                                        @click.stop>
                                        <img :src="dragDots" alt="" />
                                    </span>
                                    <FormField :question="q" :type="typeMeta(q.type)" />
                                </div>

                                <div v-else class="fb__card">
                                    <div class="fb__card-top">
                                        <span class="fb__grip fb__grip--inline"
                                            :title="$t('Projects.form_drag_to_reorder')">
                                            <img :src="dragDots" alt="" />
                                        </span>
                                        <span class="fb__chip">{{ chip(q) }}</span>
                                        <div class="fb__tools">
                                            <button type="button" :class="{ 'is-on': q.hidden }"
                                                :title="$t('Projects.form_hide')" @click="q.hidden = !q.hidden">
                                                <FormIcon :name="q.hidden ? 'eye-off' : 'eye'" />
                                            </button>
                                            <!-- A trash, not an X: an X in this corner reads as "close the
                                                 editor", and this button deletes the question. -->
                                            <button type="button" class="fb__del"
                                                :title="$t('Projects.form_remove_question')"
                                                @click="remove(i)"><FormIcon name="trash" /></button>
                                            <button type="button" :title="$t('Projects.form_close_edit')"
                                                @click="open = ''"><FormIcon name="close" /></button>
                                        </div>
                                    </div>

                                    <input v-model="q.label" class="fb__label-in" :placeholder="$t('Projects.form_question_label')"
                                       >
                                    <input v-model="q.help" class="fb__help-in" :placeholder="$t('Projects.form_question_help')"
                                       >

                                    <FormField :question="q" :type="typeMeta(q.type)" />

                                    <div v-if="typeMeta(q.type).options && !q.mapTo" class="fb__options">
                                        <div v-for="(o, oi) in q.options" :key="o.id" class="fb__option">
                                            <input v-model="o.label" class="fb__opt-in"
                                                :placeholder="$t('Projects.form_option')">
                                            <button type="button" :disabled="q.options.length < 2"
                                                @click="q.options.splice(oi, 1)"><FormIcon name="close" /></button>
                                        </div>
                                        <button type="button" class="fb__opt-add" @click="addOption(q)">
                                            + {{ $t('Projects.form_add_option') }}
                                        </button>
                                    </div>

                                    <label v-if="q.type === 'rating'" class="fb__scale">
                                        {{ $t('Projects.form_scale') }}
                                        <input v-model.number="q.max" type="number" min="2" max="10">
                                    </label>

                                    <div class="fb__widths">
                                        <span class="fb__widths-label">{{ $t('Projects.form_width') }}</span>
                                        <button v-for="w in SPANS" :key="w" type="button" class="fb__width"
                                            :class="{ 'is-on': (q.span || 12) === w }" @click="q.span = w">
                                            {{ $t(`Projects.form_width_${w}`) }}
                                        </button>
                                    </div>

                                    <div class="fb__card-foot">
                                        <label v-if="typeMeta(q.type).widget !== 'info'" class="fb__check">
                                            <input v-model="q.required" type="checkbox">
                                            <span>{{ $t('Projects.form_required') }}</span>
                                        </label>
                                        <span class="fb__done" @click="open = ''">{{ $t('Projects.form_done') }}</span>
                                    </div>
                                </div>
                            </div>
                        </template>
                    </draggable>

                    <div class="fb__add-wrap">
                        <button ref="addBtn" type="button" class="fb__add" :class="{ 'is-on': menuOpen }"
                            @click="toggleMenu">
                            <FormIcon name="plus" /> {{ $t('Projects.form_add_question') }}
                        </button>

                        <!-- Teleported out of the canvas: the view scrolls, and any
                             ancestor with overflow would clip this panel. -->
                        <Teleport to="body">
                            <div v-if="menuOpen" class="fb__backdrop" @click="menuOpen = false"></div>
                            <!-- two-level catalogue: a group on the left, what it can add on the right -->
                            <div v-if="menuOpen" class="fb__menu" :style="menuStyle">
                                <div class="fb__menu-left">
                                    <input v-model="search" class="fb__search" :placeholder="$t('Projects.search')">
                                    <div class="fb__menu-head">{{ $t('Projects.form_question_types') }}</div>
                                    <button v-for="g in filteredGroups" :key="g.key" type="button" class="fb__menu-row"
                                        :class="{ 'is-on': hover === g.key }" @mouseenter="hover = g.key"
                                        @click="hover = g.key">
                                        <span>{{ g.title }}</span><span class="fb__caret">&#8250;</span>
                                    </button>
                                </div>
                                <div v-if="hovered" class="fb__menu-right">
                                    <template v-if="hovered.create.length">
                                        <div class="fb__menu-head">{{ $t('Projects.form_create_field') }}</div>
                                        <button v-for="c in hovered.create" :key="c.type" type="button"
                                            class="fb__menu-item" @click="addQuestion({ type: c.type, label: c.title })">
                                            {{ c.title }}
                                        </button>
                                    </template>
                                    <template v-if="settings.createTask && hovered.mapTo.length">
                                        <div class="fb__menu-head">{{ $t('Projects.form_map_task') }}</div>
                                        <button v-for="p in hovered.mapTo" :key="p.property" type="button"
                                            class="fb__menu-item" :disabled="usedProperty(p.property)"
                                            @click="addQuestion({ mapTo: p.property, label: p.title })">
                                            {{ p.title }}
                                        </button>
                                    </template>
                                </div>
                            </div>
                        </Teleport>
                    </div>
                </template>
            </div>

            <div v-if="view === 'build' && !showSubmissions" class="fb__side">
                <div class="fb__side-block">
                    <label class="fb__toggle">
                        <span>{{ $t('Projects.form_create_task') }}</span>
                        <input v-model="settings.createTask" type="checkbox">
                    </label>
                    <p class="fb__hint">{{ $t('Projects.form_create_task_hint') }}</p>
                </div>

                <!-- Both only decide where a task goes, so neither means anything
                     to a form that files none. -->
                <div v-if="settings.createTask" class="fb__side-block">
                    <div class="fb__side-head">{{ $t('Projects.form_target_sprint') }}</div>
                    <select v-model="sprintId" class="fb__select">
                        <option value="">{{ $t('Projects.form_pick_sprint') }}</option>
                        <option v-for="s in sprints" :key="s.id" :value="s.id">{{ s.name }}</option>
                    </select>
                    <div class="fb__side-head">{{ $t('Projects.form_task_type') }}</div>
                    <select v-model="taskTypeKey" class="fb__select">
                        <option value="">{{ $t('Projects.form_default_task_type') }}</option>
                        <option v-for="tt in taskTypes" :key="tt.key" :value="tt.key">{{ tt.name }}</option>
                    </select>
                </div>

                <div class="fb__side-block">
                    <label v-for="tog in TOGGLES" :key="tog" class="fb__toggle">
                        <span>{{ $t(`Projects.form_${tog}`) }}</span>
                        <input v-model="settings[tog]" type="checkbox">
                    </label>
                </div>

                <div class="fb__side-block">
                    <div class="fb__side-head">{{ $t('Projects.form_title_align') }}</div>
                    <div class="fb__aligns">
                        <button v-for="a in ALIGNMENTS" :key="a" type="button" class="fb__align"
                            :class="{ 'is-on': settings.titleAlign === a }"
                            :title="$t(`Projects.form_align_${a}`)" @click="settings.titleAlign = a">
                            <FormIcon :name="`align-${a}`" />
                        </button>
                    </div>
                    <label class="fb__toggle">
                        <span>{{ $t('Projects.form_title_divider') }}</span>
                        <input v-model="settings.titleDivider" type="checkbox">
                    </label>
                </div>

                <div class="fb__side-block">
                    <div class="fb__side-head">{{ $t('Projects.form_colors') }}</div>
                    <div class="fb__themes">
                        <button v-for="th in THEMES" :key="th" type="button" class="fb__theme"
                            :class="{ 'is-on': settings.theme === th }" @click="settings.theme = th">
                            {{ $t(`Projects.form_theme_${th}`) }}
                        </button>
                    </div>
                    <div class="fb__swatch-label">{{ $t('Projects.form_background') }}</div>
                    <div class="fb__swatches">
                        <button v-for="c in BACKGROUNDS" :key="c" type="button" class="fb__swatch"
                            :class="{ 'is-on': settings.background === c }" :style="{ background: c }"
                            @click="settings.background = c"></button>
                    </div>
                    <div class="fb__swatch-label">{{ $t('Projects.form_button_color') }}</div>
                    <div class="fb__swatches">
                        <button v-for="c in BUTTON_COLORS" :key="c" type="button" class="fb__swatch"
                            :class="{ 'is-on': settings.buttonColor === c }" :style="{ background: c }"
                            @click="settings.buttonColor = c"></button>
                    </div>
                </div>
            </div>
        </div>

        <ConfirmDelete v-if="confirming" :title="$t('Projects.form_delete_title', { title: form.title || '' })"
            :description="$t('Projects.form_delete_desc')" :confirm-label="$t('Projects.form_delete')"
            :busy="busy" @cancel="confirming = false" @confirm="destroy" />
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, defineProps, defineEmits } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiRequest } from '@/services';
import { useToast } from 'vue-toast-notification';
import FormField from './FormField.vue';
import FormIcon from './FormIcon.vue';
import FormSubmissions from './FormSubmissions.vue';
import ConfirmDelete from '@/components/atom/ConfirmDelete/ConfirmDelete.vue';
import draggable from 'vuedraggable';
import dragDots from '@/assets/images/svg/drag_dots.svg';

const { t } = useI18n();
const toast = useToast();
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
const menuOpen = ref(false);
const hover = ref('');
const search = ref('');

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

const filteredGroups = computed(() => {
    const term = search.value.trim().toLowerCase();
    if (!term) return groups.value;
    return groups.value.filter((g) => g.title.toLowerCase().includes(term)
        || g.create.some((c) => c.title.toLowerCase().includes(term))
        || g.mapTo.some((m) => m.title.toLowerCase().includes(term)));
});
const hovered = computed(() => filteredGroups.value.find((g) => g.key === hover.value) || filteredGroups.value[0]);

/* The panel is fixed-positioned from the button's own rectangle, and flips above
 * it when there is more room there — the button sits at the bottom of a growing
 * canvas, so "always downwards" ran off the screen. */
const addBtn = ref(null);
const menuStyle = ref({});
const MENU_WIDTH = 470;
const placeMenu = () => {
    const el = addBtn.value;
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    const room = { below: window.innerHeight - r.bottom - gap - 12, above: r.top - gap - 12 };
    const below = room.below >= 280 || room.below >= room.above;
    menuStyle.value = {
        left: `${Math.max(12, Math.min(r.left, window.innerWidth - MENU_WIDTH - 12))}px`,
        top: below ? `${r.bottom + gap}px` : 'auto',
        bottom: below ? 'auto' : `${window.innerHeight - r.top + gap}px`,
        maxHeight: `${Math.max(220, below ? room.below : room.above)}px`,
    };
};
const toggleMenu = () => {
    menuOpen.value = !menuOpen.value;
    if (menuOpen.value) nextTick(placeMenu);
};
// Capture phase: the scroll happens on the view's own container, not the window.
watch(menuOpen, (on) => {
    if (on) {
        window.addEventListener('scroll', placeMenu, true);
        window.addEventListener('resize', placeMenu);
    } else {
        window.removeEventListener('scroll', placeMenu, true);
        window.removeEventListener('resize', placeMenu);
    }
});
onBeforeUnmount(() => {
    window.removeEventListener('scroll', placeMenu, true);
    window.removeEventListener('resize', placeMenu);
});

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
    menuOpen.value = false;
    baseline.value = JSON.stringify(payload());
};

const loadCatalogue = async () => {
    try {
        const body = (await apiRequest('get', '/api/v2/forms/fields'))?.data;
        groups.value = (body && body.status && body.data && body.data.groups) || [];
        widgets.value = (body && body.status && body.data && body.data.widgets) || {};
        hover.value = (groups.value[0] && groups.value[0].key) || '';
    } catch (e) { groups.value = []; }
};

onMounted(() => { hydrate(); loadCatalogue(); });
watch(() => props.form._id, hydrate);

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
    menuOpen.value = false;
    open.value = q.id;
};

const remove = (i) => { questions.value.splice(i, 1); open.value = ''; };

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

<style scoped>
.fb { display: flex; flex-direction: column; }
.fb__tabs { display: flex; align-items: center; gap: 4px; border-bottom: 1px solid #e9eaf2; padding: 0 4px; }
.fb__tab { background: none; border: 0; border-bottom: 2px solid transparent; padding: 12px 14px;
    font-size: 14px; color: #7c8195; cursor: pointer; }
.fb__tab.is-on { color: #2f3990; border-bottom-color: #2f3990; font-weight: 600; }
.fb__tabs-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.fb__icon { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
    border: 1px solid #e3e5f0; border-radius: 7px; background: #fff; color: #6b7280; font-size: 16px;
    text-decoration: none; cursor: pointer; padding: 0; }
.fb__icon:hover { background: #f4f5fb; color: #2f3990; border-color: #d7d9e6; }
.fb__btn { border: 1px solid #d7d9e6; background: #fff; color: #3b4252; border-radius: 7px;
    padding: 7px 14px; font-size: 13px; cursor: pointer; }
.fb__btn--primary { background: #2f3990; border-color: #2f3990; color: #fff; }
.fb__btn:disabled { opacity: .6; cursor: default; }
.fb__btn--dirty { border-color: #2f3990; color: #2f3990; font-weight: 600; }
.fb__icon--del:hover { color: #e2645c; border-color: #f0cfcb; background: #fdf4f3; }
.fb__icon--del:disabled { opacity: .5; cursor: default; }
.fb__err { margin: 10px 4px 0; background: #fdf1f0; color: #a33227; border: 1px solid #f0cfcb;
    border-radius: 7px; padding: 9px 12px; font-size: 13px; }
.fb__warn { display: flex; align-items: center; gap: 12px; margin: 10px 4px 0; background: #fff8ec;
    color: #8a5a11; border: 1px solid #f2ddb6; border-radius: 7px; padding: 9px 12px; font-size: 13px; }
.fb__warn span { flex: 1 1 auto; }
.fb__warn-btn { flex: 0 0 auto; border: 1px solid #e0c48a; background: #fff; color: #8a5a11;
    border-radius: 6px; padding: 5px 11px; font-size: 12px; cursor: pointer; }
.fb__warn-btn:hover { background: #fdf3e2; }

/* Deliberately not a scroller: the view around it already scrolls, and a second
   one both showed two scrollbars and clipped anything drawn outside it. */
.fb__body { display: flex; gap: 20px; align-items: flex-start; padding: 20px 4px 40px; }
.fb__wide { flex: 1 1 auto; min-width: 0; }
/* Build fills the space left by the settings panel; a narrow canvas there wastes
   room the width controls need. Preview is centred and bounded, so it reads like
   the page a submitter actually gets. */
.fb__canvas { flex: 1 1 auto; min-width: 0; background: #fff;
    border: 1px solid #e9eaf2; border-radius: 12px; padding: 26px 28px 30px; }
.fb__head { margin: 0 0 20px; }
.fb__head--left { text-align: left; }
.fb__head--center { text-align: center; }
.fb__head--right { text-align: right; }
.fb__head--rule { padding-bottom: 14px; border-bottom: 1px solid #e9eaf2; }
.fb__title { font-size: 21px; margin: 0 0 6px; color: #1f2333; }
.fb__desc { font-size: 14px; color: #6b7280; margin: 0; line-height: 1.6; }
.fb__empty { color: #9aa0b4; font-size: 14px; padding: 18px 0; }

.fb__grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 18px 24px; }
/* The build canvas needs less, because each field there carries its own padding
   for the hover box and the pencil. */
.fb__grid--build { gap: 6px 12px; }
.fb__cell { min-width: 0; position: relative; grid-column: span 12; }
/* Width per question, in twelfths, so one row can hold halves, thirds or quarters. */
.fb__cell--s12 { grid-column: span 12; }
.fb__cell--s6 { grid-column: span 6; }
.fb__cell--s4 { grid-column: span 4; }
.fb__cell--s3 { grid-column: span 3; }
/* The grip is the only drag handle, so a click anywhere else still opens the
   question for editing. */
.fb__grip { position: absolute; left: -19px; top: 12px; display: flex; align-items: center;
    padding: 2px; cursor: grab; opacity: 0; transition: opacity .12s ease; touch-action: none; }
.fb__grip img { width: 9px; height: 16px; display: block; }
.fb__grip:active { cursor: grabbing; }
.fb__cell:hover .fb__grip, .fb__grip:focus-visible { opacity: 1; }
.fb__grip--inline { position: static; opacity: .5; margin-right: 2px; }
/* Inside the field, on the label line. The label reserves room for it below, so
   a long label in a narrow column cannot end up underneath it. */
.fb__editcue { position: absolute; right: 10px; top: 8px; display: flex; align-items: center;
    justify-content: center; width: 20px; height: 20px; border: 1px solid #dfe2f0; border-radius: 6px;
    background: #fff; color: #8a90a6; font-size: 12px; padding: 0; cursor: pointer;
    opacity: 0; transition: opacity .12s ease; }
.fb__editcue:hover { color: #2f3990; border-color: #b9c0ea; background: #f4f5fb; }
.fb__cell:hover .fb__editcue, .fb__editcue:focus-visible { opacity: 1; }
.fb__peek :deep(.ff__label) { padding-right: 28px; margin-bottom: 9px; }
.fb__card:hover .fb__grip--inline { opacity: 1; }
.fb__cell--ghost { opacity: .45; }
.fb__cell--ghost .fb__peek, .fb__cell--ghost .fb__card { border-color: #6473e8; border-style: dashed; }
/* Padded to match the expanded card's 16px sides, so opening a question does not
   shift the field sideways. Roomier than the field strictly needs, which is the
   point: the label, the input and the pencil all need to breathe. */
.fb__peek { position: relative; border: 1px solid transparent; border-radius: 9px;
    padding: 12px 16px 14px; cursor: pointer; }
.fb__peek:hover { border-color: #dfe2f0; background: #fafbff; }
.fb__peek.is-hidden { opacity: .45; }

.fb__card { border: 1px solid #dfe2f0; border-radius: 10px; padding: 14px 16px 12px; background: #fff;
    box-shadow: 0 2px 10px rgba(31, 35, 51, .06); }
.fb__card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.fb__chip { font-size: 12px; color: #6473e8; background: #eef1ff; border-radius: 5px; padding: 3px 8px; }
.fb__tools { margin-left: auto; display: flex; gap: 2px; }
.fb__tools button { display: flex; align-items: center; justify-content: center; border: 0;
    background: none; cursor: pointer; color: #8a90a6; font-size: 15px; padding: 5px; border-radius: 5px; }
.fb__tools button:hover { background: #f2f3f9; }
.fb__tools button.is-on { color: #2f3990; }
.fb__del { color: #e2645c !important; }
.fb__label-in, .fb__help-in { width: 100%; border: 0; border-bottom: 1px solid transparent; padding: 3px 0;
    font-family: inherit; background: none; }
.fb__label-in { font-size: 15px; font-weight: 600; color: #1f2333; }
.fb__help-in { font-size: 12px; color: #9aa0b4; margin-bottom: 8px; }
.fb__label-in:focus, .fb__help-in:focus { outline: 0; border-bottom-color: #c9d0f5; }

.fb__options { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.fb__option { display: flex; gap: 6px; align-items: center; }
.fb__opt-in { flex: 1 1 auto; border: 1px solid #e3e5f0; border-radius: 6px; padding: 6px 9px; font-size: 13px; }
.fb__option button { display: flex; align-items: center; border: 0; background: none; color: #b6bac9;
    cursor: pointer; font-size: 14px; padding: 4px; }
.fb__option button:hover:not(:disabled) { color: #e2645c; }
.fb__opt-add { align-self: flex-start; border: 0; background: none; color: #2f3990; font-size: 13px; cursor: pointer; padding: 2px 0; }
.fb__scale { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #6b7280; margin-top: 10px; }
.fb__scale input { width: 58px; border: 1px solid #e3e5f0; border-radius: 6px; padding: 5px 8px; }

.fb__widths { display: flex; align-items: center; gap: 6px; margin-top: 12px; }
.fb__widths-label { font-size: 12px; color: #9aa0b4; margin-right: 2px; }
.fb__width { border: 1px solid #e3e5f0; background: #fff; color: #6b7280; border-radius: 6px;
    padding: 4px 10px; font-size: 12px; cursor: pointer; font-variant-numeric: tabular-nums; }
.fb__width:hover { background: #f4f5fb; }
.fb__width.is-on { border-color: #6473e8; color: #2f3990; background: #eef1ff; font-weight: 600; }
.fb__card-foot { display: flex; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid #f0f1f7; }
.fb__check { display: flex; align-items: center; gap: 7px; font-size: 13px; color: #3b4252; }
.fb__done { margin-left: auto; font-size: 13px; color: #2f3990; cursor: pointer; }

.fb__add-wrap { position: relative; margin-top: 22px; }
.fb__add { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;
    border: 1px dashed #d7d9e6; background: #fafbff; color: #3b4252; border-radius: 9px;
    padding: 13px; font-size: 14px; cursor: pointer; }
.fb__add.is-on, .fb__add:hover { background: #eef1ff; border-color: #b9c0ea; color: #2f3990; }
/* Teleported to <body>, so it inherits neither the app font nor the view's
   stacking context — both are set explicitly here. */
.fb__menu { position: fixed; z-index: 1210; display: flex; align-items: stretch;
    font-family: 'Roboto', sans-serif; background: #fff; border: 1px solid #e3e5f0;
    border-radius: 10px; box-shadow: 0 10px 30px rgba(31, 35, 51, .16); overflow: hidden; }
.fb__menu-left, .fb__menu-right { min-height: 0; overflow-y: auto; }
.fb__menu-left { width: 210px; padding: 8px; border-right: 1px solid #f0f1f7; }
.fb__menu-right { width: 240px; padding: 8px; }
.fb__backdrop { position: fixed; inset: 0; z-index: 1200; }
.fb__search { width: 100%; border: 1px solid #e3e5f0; border-radius: 7px; padding: 7px 10px;
    font-size: 13px; margin-bottom: 6px; }
.fb__menu-head { font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
    color: #9aa0b4; padding: 8px 8px 4px; }
.fb__menu-row, .fb__menu-item { display: flex; align-items: center; width: 100%; border: 0; background: none;
    text-align: left; font-size: 13px; color: #3b4252; padding: 7px 8px; border-radius: 6px; cursor: pointer; }
.fb__menu-row.is-on, .fb__menu-row:hover, .fb__menu-item:hover { background: #f4f5fb; }
.fb__menu-item:disabled { opacity: .4; cursor: default; background: none; }
.fb__caret { margin-left: auto; color: #b6bac9; }

.fb__submit { width: 100%; margin-top: 26px; border: 0; color: #fff; border-radius: 8px;
    padding: 12px; font-size: 14px; }
.fb__canvas--preview { max-width: 780px; margin: 0 auto; }

.fb__side { flex: 0 0 300px; background: #fff; border: 1px solid #e9eaf2; border-radius: 12px; padding: 6px 16px 18px; }
.fb__side-block { padding: 14px 0; border-bottom: 1px solid #f0f1f7; }
.fb__side-block:last-child { border-bottom: 0; }
.fb__side-head { font-size: 12px; font-weight: 600; color: #3b4252; margin: 10px 0 6px; }
.fb__select { width: 100%; border: 1px solid #d7d9e6; border-radius: 7px; padding: 8px 10px; font-size: 13px; background: #fff; }
.fb__toggle { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #3b4252; padding: 7px 0; }
.fb__toggle span { flex: 1 1 auto; }
.fb__hint { font-size: 12px; color: #9aa0b4; line-height: 1.5; margin: 2px 0 0; }
.fb__aligns { display: flex; gap: 8px; }
.fb__align { flex: 1 1 0; display: flex; align-items: center; justify-content: center; padding: 7px;
    font-size: 16px; color: #6b7280; background: #fff; border: 1px solid #e3e5f0; border-radius: 7px;
    cursor: pointer; }
.fb__align:hover { background: #f4f5fb; }
.fb__align.is-on { border-color: #6473e8; color: #2f3990; background: #eef1ff; }
.fb__themes { display: flex; gap: 8px; }
.fb__theme { flex: 1 1 0; border: 1px solid #e3e5f0; background: #fff; border-radius: 7px;
    padding: 7px; font-size: 12px; color: #6b7280; cursor: pointer; }
.fb__theme.is-on { border-color: #6473e8; color: #2f3990; }
.fb__swatch-label { font-size: 12px; color: #9aa0b4; margin: 12px 0 6px; }
.fb__swatches { display: flex; flex-wrap: wrap; gap: 7px; }
.fb__swatch { width: 22px; height: 22px; border-radius: 50%; border: 1px solid #e3e5f0; cursor: pointer; }
.fb__swatch.is-on { box-shadow: 0 0 0 2px #6473e8; }

@media (max-width: 900px) {
    .fb__body { flex-direction: column; }
    .fb__side { flex: 1 1 auto; width: 100%; }
    /* One per row once the canvas is narrow: thirds and quarters stop being
       editable at that width. */
    .fb__cell, .fb__cell--s3, .fb__cell--s4, .fb__cell--s6 { grid-column: span 12; }
}
</style>

import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { duplicateProgress, shareFields } from '@/views/Projects/duplicateProject';
import { createFromTemplate } from '@/views/Projects/projectTemplates';

const POLL_MS = 1500;
const CHOICES = ['tasks', 'assignees', 'dates', 'automations'];
const NOTE_TEXT = {
    automations_disabled: 'Projects.duplicate_automations_off',
    automations_skipped: 'Projects.template_note_automations_skipped',
    people_skipped: 'Projects.template_note_people_skipped',
    statuses_skipped: 'Projects.template_note_statuses_skipped',
    fields_skipped: 'Projects.template_note_fields_skipped',
    tasks_left_out: 'Projects.template_note_tasks_left_out',
};

const twoDigits = (n) => String(n).padStart(2, '0');
const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
};

/* A template offers a choice only for what it holds. */
const holds = (template, key) => {
    if (template?.include?.[key] !== true) return false;
    if (key === 'tasks' || key === 'assignees') return Number(template.counts?.tasks) > 0;
    return key !== 'automations' || Number(template.counts?.automations) > 0;
};

/* Makes a project from a saved template: what to bring along, the start its dates are counted from, and the progress of one
   large enough for its tasks to arrive after the answer. `onReady(project)` runs once the project can be opened. */
export function useTemplateProject({ store, toast, t, onReady }) {
    const include = reactive({ tasks: false, assignees: false, dates: false, automations: false });
    const start = ref(today());
    const job = ref(null);
    const offered = ref([]);
    let timer = null;
    let closed = false;

    const percent = computed(() => (job.value?.total ? Math.min(100, Math.round((job.value.processed / job.value.total) * 100)) : 0));

    function reset(template) {
        offered.value = CHOICES.filter((key) => holds(template, key));
        CHOICES.forEach((key) => { include[key] = offered.value.includes(key); });
        start.value = today();
    }

    const tasksChanged = () => { if (!include.tasks) include.assignees = false; };

    function finish(project, notes, { complete = true } = {}) {
        if (complete) toast.success(t('Projects.duplicate_done', { name: project.ProjectName }), { position: 'top-right' });
        (notes || []).filter((note) => NOTE_TEXT[note.code]).forEach((note) => {
            toast.info(t(NOTE_TEXT[note.code], { count: note.count }), { position: 'top-right' });
        });
        onReady(project);
    }

    function watchJob(project, notes) {
        timer = setTimeout(async () => {
            const latest = await duplicateProgress(project._id);
            if (closed) return;
            if (latest) job.value = latest;
            if (latest?.status === 'failed') {
                toast.error(t('Projects.duplicate_tasks_failed', { created: latest.created, total: latest.total }), { position: 'top-right' });
                finish(project, notes, { complete: false });
                return;
            }
            if (latest?.status === 'done') { finish(project, notes); return; }
            watchJob(project, notes);
        }, POLL_MS);
    }

    /* Answers { ok: false, message } for a refusal; otherwise the project is in the store and opens when its tasks are in. */
    async function create(template, { name, code, isPrivate }) {
        const dated = include.dates && start.value;
        const answer = await createFromTemplate(template._id, {
            name,
            code,
            isPrivate,
            include: { ...include, assignees: include.assignees && include.tasks },
            ...(dated ? { startDate: new Date(`${start.value}T00:00:00`).toISOString() } : {}),
        });
        if (!answer.ok) return answer;
        store.commit('projectData/mutateProjects', [{ snap: null, privateSnap: false, op: 'added', data: { ...answer.project, id: answer.project._id } }]);
        shareFields(store, answer.sharedFields, answer.project._id);
        if (closed) return answer;
        if (!answer.job) { finish(answer.project, answer.notes); return answer; }
        job.value = { processed: 0, created: 0, ...answer.job };
        watchJob(answer.project, answer.notes);
        return answer;
    }

    onBeforeUnmount(() => { closed = true; clearTimeout(timer); });

    return { include, start, job, percent, offered, reset, tasksChanged, create };
}

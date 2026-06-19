<template>
  <div class="rt">
    <div class="rt__head">
      <span class="rt__title">Recurring tasks</span>
      <button class="rt__primary" type="button" @click="showForm = !showForm">{{ showForm ? 'Close' : '+ New recurring task' }}</button>
    </div>

    <form v-if="showForm" class="rt__form" @submit.prevent="create">
      <div class="rt__row">
        <input v-model="form.name" class="rt__in" placeholder="Definition name (e.g. Weekly standup)" required />
        <input v-model="form.taskName" class="rt__in" placeholder="Task title to create each time" required />
      </div>
      <div class="rt__row">
        <select v-model="form.freq" class="rt__sel">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <label class="rt__lbl">every <input type="number" min="1" v-model.number="form.interval" class="rt__num" /> {{ unitLabel }}</label>
        <label class="rt__lbl">at <input type="number" min="0" max="23" v-model.number="form.runHour" class="rt__num" />:00</label>
      </div>
      <div v-if="form.freq === 'weekly'" class="rt__days">
        <label v-for="(d, i) in weekdays" :key="i" class="rt__day"><input type="checkbox" :value="i" v-model="form.byweekday" />{{ d }}</label>
      </div>
      <div v-if="form.freq === 'monthly'" class="rt__row">
        <label class="rt__lbl">day of month <input type="number" min="1" max="28" v-model.number="form.monthday" class="rt__num" /></label>
      </div>
      <div class="rt__row">
        <select v-model="form.priority" class="rt__sel">
          <option>LOW</option><option>MEDIUM</option><option>HIGH</option>
        </select>
        <label class="rt__lbl"><input type="checkbox" v-model="form.assignMe" /> Assign to me</label>
        <label class="rt__lbl"><input type="checkbox" v-model="form.skipIfOpen" /> Skip if previous still open</label>
        <button class="rt__primary" type="submit" :disabled="saving">{{ saving ? 'Saving…' : 'Create' }}</button>
      </div>
    </form>

    <div v-if="loading" class="rt__msg">Loading…</div>
    <div v-else-if="!defs.length" class="rt__msg">No recurring tasks yet. Create one above to have tasks generated on a schedule.</div>
    <table v-else class="rt__table">
      <thead>
        <tr><th>Name</th><th>Task</th><th>Schedule</th><th>Next run</th><th>Runs</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="d in defs" :key="d._id" :class="{ 'rt--paused': !d.enabled }">
          <td>{{ d.name }}</td>
          <td>{{ d.templateSnapshot && d.templateSnapshot.TaskName }}</td>
          <td>{{ scheduleText(d) }}</td>
          <td>{{ fmtDate(d.nextRunAt) }}</td>
          <td>{{ d.runCount || 0 }}</td>
          <td class="rt__actions">
            <button type="button" @click="runNow(d)" title="Create one task now">Run now</button>
            <button type="button" @click="toggle(d)">{{ d.enabled ? 'Pause' : 'Resume' }}</button>
            <button type="button" class="rt__del" @click="remove(d)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script>
export default { name: 'RecurringTasksManager' };
</script>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue';
import { useStore } from 'vuex';
import { apiRequest } from '@/services';
import { useToast } from 'vue-toast-notification';

const props = defineProps({
    projectData: { type: Object, default: () => ({}) },
    sprints: { type: Array, default: () => [] },
});

const { getters } = useStore();
const toast = useToast();
const selectedProject = inject('selectedProject', ref({}));

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const defs = ref([]);
const loading = ref(false);
const saving = ref(false);
const showForm = ref(false);
const form = reactive({
    name: '', taskName: '', freq: 'weekly', interval: 1, byweekday: [1], monthday: 1,
    runHour: 9, priority: 'MEDIUM', assignMe: true, skipIfOpen: false,
});

const unitLabel = computed(() => ({ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)' }[form.freq]));

function project() { return (selectedProject.value && selectedProject.value._id) ? selectedProject.value : props.projectData; }
function buildUserData() {
    const uid = localStorage.getItem('userId');
    const me = (getters['users/users'] || []).find((u) => String(u._id) === String(uid)) || {};
    return { id: uid, Employee_Name: me.Employee_Name || '', companyOwnerId: getters['settings/companyOwnerDetail']?.userId || '' };
}
function fmtDate(d) { return d ? new Date(d).toLocaleString() : '—'; }
function scheduleText(d) {
    const at = `${String(d.runHour ?? 9).padStart(2, '0')}:00`;
    if (d.freq === 'weekly') {
        const days = (d.byweekday || []).map((i) => weekdays[i]).join(', ') || 'weekly';
        return `Weekly on ${days} at ${at}`;
    }
    if (d.freq === 'monthly') return `Monthly on day ${d.monthday || 1} at ${at}`;
    return `Every ${d.interval || 1} day(s) at ${at}`;
}

const load = async () => {
    const p = project();
    if (!p || !p._id) return;
    loading.value = true;
    try {
        const res = await apiRequest('get', `/api/v1/recurring-tasks/project/${p._id}`);
        defs.value = (res.data && res.data.status && Array.isArray(res.data.data)) ? res.data.data : [];
    } catch (e) {
        defs.value = [];
    } finally {
        loading.value = false;
    }
};

const create = async () => {
    const p = project();
    const sprint = props.sprints?.[0] || {};
    const uid = localStorage.getItem('userId');
    if (!p || !p._id) { toast.error('No project context', { position: 'top-right' }); return; }
    saving.value = true;
    try {
        const body = {
            name: form.name,
            taskName: form.taskName,
            freq: form.freq,
            interval: form.interval,
            byweekday: form.byweekday,
            monthday: form.monthday,
            runHour: form.runHour,
            priority: form.priority,
            skipIfOpen: form.skipIfOpen,
            assignees: (form.assignMe && uid) ? [uid] : [],
            projectData: { _id: p._id, CompanyId: p.CompanyId, ProjectCode: p.ProjectCode, ProjectName: p.ProjectName },
            sprintArray: sprint,
            sprintId: sprint.id || sprint._id || '',
            userData: buildUserData(),
        };
        const res = await apiRequest('post', '/api/v1/recurring-tasks', body);
        if (res.data && res.data.status) {
            toast.success('Recurring task created', { position: 'top-right' });
            showForm.value = false;
            form.name = ''; form.taskName = '';
            await load();
        } else {
            toast.error(res.data?.statusText || 'Could not create', { position: 'top-right' });
        }
    } catch (e) {
        toast.error('Could not create recurring task', { position: 'top-right' });
    } finally {
        saving.value = false;
    }
};

const toggle = async (d) => {
    try {
        await apiRequest('patch', `/api/v1/recurring-tasks/${d._id}`, { enabled: !d.enabled });
        await load();
    } catch (e) { toast.error('Update failed', { position: 'top-right' }); }
};
const remove = async (d) => {
    try {
        await apiRequest('delete', `/api/v1/recurring-tasks/${d._id}`);
        await load();
    } catch (e) { toast.error('Delete failed', { position: 'top-right' }); }
};
const runNow = async (d) => {
    try {
        const res = await apiRequest('post', `/api/v1/recurring-tasks/${d._id}/run-now`, {});
        toast.success(res.data?.statusText || 'Task created', { position: 'top-right' });
        await load();
    } catch (e) { toast.error('Run failed', { position: 'top-right' }); }
};

onMounted(load);
</script>

<style scoped>
.rt { width: 100%; padding: 14px 16px; background: #fff; }
.rt__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.rt__title { font-size: 16px; font-weight: 600; color: #2F3990; }
.rt__primary { border: none; background: #2F3990; color: #fff; border-radius: 6px; padding: 7px 16px; font-size: 13px; cursor: pointer; }
.rt__primary:disabled { opacity: .5; cursor: not-allowed; }
.rt__form { border: 1px solid #e6e6ee; border-radius: 8px; padding: 14px; margin-bottom: 16px; background: #fafafe; }
.rt__row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; }
.rt__in { flex: 1 1 220px; border: 1px solid #d8d8e0; border-radius: 6px; padding: 7px 10px; font-size: 13px; }
.rt__sel { border: 1px solid #d8d8e0; border-radius: 6px; padding: 7px 10px; font-size: 13px; background: #fff; }
.rt__lbl { font-size: 13px; color: #555; display: inline-flex; align-items: center; gap: 5px; }
.rt__num { width: 54px; border: 1px solid #d8d8e0; border-radius: 6px; padding: 5px 6px; font-size: 13px; }
.rt__days { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.rt__day { font-size: 12px; color: #555; display: inline-flex; align-items: center; gap: 3px; }
.rt__msg { color: #888; font-size: 14px; padding: 32px; text-align: center; }
.rt__table { width: 100%; border-collapse: collapse; font-size: 13px; }
.rt__table th { text-align: left; color: #888; font-weight: 500; padding: 8px 10px; border-bottom: 1px solid #eee; }
.rt__table td { padding: 9px 10px; border-bottom: 1px solid #f2f2f6; color: #444; }
.rt--paused { opacity: .55; }
.rt__actions { display: flex; gap: 6px; }
.rt__actions button { border: 1px solid #2F3990; color: #2F3990; background: #fff; border-radius: 5px; font-size: 12px; padding: 4px 9px; cursor: pointer; }
.rt__actions .rt__del { border-color: #c0392b; color: #c0392b; }
</style>

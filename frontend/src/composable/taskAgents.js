/**
 * Automation agents as task assignees.
 *
 * An agent is offered wherever a person is — List, Board, Table, subtasks, the task
 * detail panel — so this exists to make that cheap. The naive version asks the
 * server which agents apply to each task, which is one request per visible row; a
 * board with sixty cards would fire sixty. Instead the company's agents are fetched
 * ONCE per page and applicability is resolved locally.
 *
 * The scope rule is therefore duplicated from Modules/Agents/helpers/scope.js. That
 * is deliberate and safe: this copy decides only what to SHOW. The server re-checks
 * scope before it attaches anything (assignToTask → scopeApplies), so a stale or
 * wrong answer here can never grant access — at worst it offers an agent the server
 * then refuses, with the reason surfaced in the toast.
 */
import { ref } from 'vue';
import { useToast } from 'vue-toast-notification';
import { apiRequest } from '@/services';
import * as env from '@/config/env';

// Module-level: every component that calls useTaskAgents() shares one list and one
// set of pending changes, so assigning in Board is instantly visible in Table.
const agents = ref([]);
const loadFailed = ref(false);
let loadedFor = '';
let inflight = null;

/**
 * Optimistic overrides, taskId -> array of agent ids.
 *
 * The socket broadcast from the server is what ultimately updates the task, but the
 * row must respond to the click immediately, and list rows receive their task as a
 * prop that must not be mutated. This holds the intended state until the real
 * document arrives.
 */
const overrides = ref({});

const str = (v) => (v === null || v === undefined ? '' : String(v));

export function useTaskAgents() {
    /** Fetch once per company. Safe to call from every component's onMounted. */
    const load = async (companyId = '') => {
        const key = str(companyId) || 'current';
        if (loadedFor === key) return agents.value;
        if (inflight) return inflight;

        inflight = apiRequest('get', env.AGENTS)
            .then((res) => {
                if (res && res.data && res.data.status) {
                    // Only enabled agents can be assigned — a paused one would be
                    // offered and then refused.
                    agents.value = (res.data.data.agents || []).filter((a) => a && a.enabled);
                    loadedFor = key;
                    loadFailed.value = false;
                }
                return agents.value;
            })
            .catch((error) => {
                // Agents are an optional extra on every one of these views. Never let
                // a failure here stop the assignee picker from opening.
                loadFailed.value = true;
                console.error('Could not load agents for assignment', error);
                return [];
            })
            .finally(() => { inflight = null; });

        return inflight;
    };

    /**
     * Which agents apply to this task, narrowest scope first.
     *
     * Mirrors ancestorScopes(): a task inherits from its sprint, folder, project and
     * the company, so a company-wide agent applies everywhere without being recorded
     * against anything.
     */
    const agentsForTask = (task) => {
        if (!task || !agents.value.length) return [];
        const scopeOf = (a) => (a && a.scope) || {};
        return agents.value.filter((a) => {
            const level = str(scopeOf(a).level);
            const refId = str(scopeOf(a).refId);
            if (level === 'company') return true;
            if (!refId) return false;
            if (level === 'project') return refId === str(task.ProjectID);
            if (level === 'folder') return refId === str(task.folderObjId);
            if (level === 'sprint') return refId === str(task.sprintId);
            if (level === 'task') return refId === str(task._id);
            return false;
        });
    };

    /** The agent ids currently on this task, honouring an optimistic change. */
    const selectedAgentsFor = (task) => {
        if (!task) return [];
        const id = str(task._id);
        if (Object.prototype.hasOwnProperty.call(overrides.value, id)) return overrides.value[id];
        return (task.assignedAgentIds || []).map(str);
    };

    /**
     * Attach or detach an agent. Resolves { ok, message }.
     *
     * Never throws: it is called straight from a click handler in a list row.
     */
    const setAgentOnTask = async (task, agentId, attached) => {
        const taskId = str(task && task._id);
        const id = str(agentId);
        if (!taskId || !id) return { ok: false, message: 'Missing task or agent.' };

        const before = selectedAgentsFor(task);
        overrides.value = {
            ...overrides.value,
            [taskId]: attached ? [...new Set([...before, id])] : before.filter((x) => x !== id),
        };

        try {
            const res = await apiRequest('post', `${env.AGENTS}/${id}/assign`, { taskId, attached });
            if (!res || !res.data || !res.data.status) {
                // Put it back — the server refused, so the row must not keep showing
                // a change that did not happen.
                overrides.value = { ...overrides.value, [taskId]: before };
                return { ok: false, message: (res && res.data && res.data.statusText) || 'Could not update the agent on this task.' };
            }
            return { ok: true, message: res.data.statusText || '' };
        } catch (error) {
            overrides.value = { ...overrides.value, [taskId]: before };
            return { ok: false, message: (error && error.message) || 'Could not update the agent on this task.' };
        }
    };

    /**
     * The one call a view needs: attach/detach and report the outcome.
     *
     * The toast lives here rather than in each caller because these four views have
     * inconsistent setups — some import useToast, some don't, some have onMounted,
     * some don't — and wiring the same three lines into each is how they drift.
     * A view supplies the props and this function; nothing else.
     */
    const assignAgent = async (task, event, attached) => {
        const res = await setAgentOnTask(task, event && event.id, attached);
        const toast = useToast();
        if (res.ok) {
            if (res.message) toast.success(res.message, { position: 'top-right' });
        } else {
            toast.error(res.message, { position: 'top-right' });
        }
        return res;
    };

    /** Drop the optimistic value once the real document has caught up. */
    const syncFromTask = (task) => {
        const id = str(task && task._id);
        if (!id || !Object.prototype.hasOwnProperty.call(overrides.value, id)) return;
        const actual = (task.assignedAgentIds || []).map(str).sort().join(',');
        if (actual === [...overrides.value[id]].sort().join(',')) {
            const next = { ...overrides.value };
            delete next[id];
            overrides.value = next;
        }
    };

    // Fetching is idempotent and cached, so a caller can just invoke this at setup
    // without needing an onMounted hook of its own.
    load();

    return { agents, loadFailed, load, agentsForTask, selectedAgentsFor, setAgentOnTask, assignAgent, syncFromTask };
}

export default useTaskAgents;

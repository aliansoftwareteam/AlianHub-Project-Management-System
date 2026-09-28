import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { shellState } from "@/components/organisms/Shell/shellState";

// The LIVE strip, the rail badge and the AI sidebar all count from this one read of the
// team, so none of them can say an agent is idle while another names what it is working on.
export const LIVE_POLL_MS = 30000;

const people = ref([]);
const agents = ref([]);
// A paused agent can still hold a run waiting on a person; the server counts it as paused, not live.
const live = computed(() => agents.value.filter((a) => a.status === "running" && a.run));
const running = computed(() => live.value.length);

const onPollHooks = new Set();
let subscribers = 0;
let poller = null;

export async function refreshLiveAgents() {
    const res = await apiRequest("get", env.AGENT_TEAM);
    if (res?.data?.status !== true) return;
    const data = res.data.data || {};
    people.value = data.people || [];
    agents.value = data.agents || [];
    shellState.agentsRunning = running.value;
}

const quietly = (fn) => Promise.resolve().then(fn).catch(() => {});

const poll = () => {
    quietly(refreshLiveAgents);
    onPollHooks.forEach((hook) => quietly(hook));
};

/* One poller however many components watch: the first to mount starts it, the last to leave
 * stops it. onPoll runs alongside every read, and once on mount if the poller was already going. */
export function useLiveAgents({ onPoll } = {}) {
    onMounted(() => {
        if (onPoll) onPollHooks.add(onPoll);
        subscribers += 1;
        if (subscribers === 1) {
            poll();
            poller = setInterval(poll, LIVE_POLL_MS);
        } else if (onPoll) {
            quietly(onPoll);
        }
    });

    onBeforeUnmount(() => {
        if (onPoll) onPollHooks.delete(onPoll);
        subscribers -= 1;
        if (subscribers > 0) return;
        clearInterval(poller);
        poller = null;
    });

    return { people, agents, live, running, refresh: refreshLiveAgents };
}

import { inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { agents, bindAgentSocket, live, people, refreshAgentFeed, running, subscribeAgentFeed } from "./agentFeed";

/* onRuns is handed the latest runs after each read of them: the strip's finish toast watches them
 * without a request of its own. */
export function useLiveAgents({ onRuns } = {}) {
    const socket = inject("$socket", ref(null));
    let release = null;

    onMounted(() => {
        release = subscribeAgentFeed({ onRuns });
        bindAgentSocket(socket?.value);
    });
    watch(() => socket?.value, bindAgentSocket);
    onBeforeUnmount(() => release?.());

    return { people, agents, live, running, refresh: refreshAgentFeed };
}

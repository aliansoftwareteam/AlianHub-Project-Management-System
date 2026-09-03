import { computed, ref } from "vue";
import { useStore } from "vuex";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

// Names for the people and agents on a completion record. The workspace agents
// are fetched once per session and shared by every badge on screen — a Done
// column can hold fifty of them.

const agents = ref([]);
let agentsRequest = null;

const ensureAgents = () => {
    if (!agentsRequest) {
        agentsRequest = apiRequest("get", env.AGENTS)
            .then((res) => { agents.value = res?.data?.status ? res.data.data || [] : []; })
            .catch(() => { agents.value = []; });
    }
    return agentsRequest;
};

export function useProvenanceActors() {
    const { getters } = useStore();
    const people = computed(() => getters["users/users"] || []);

    const personOf = (actorId) => people.value.find((user) => String(user._id) === String(actorId)) || null;
    const agentOf = (agentId) => agents.value.find((agent) => String(agent._id) === String(agentId)) || null;

    const personName = (actorId) => {
        const person = personOf(actorId);
        return person ? person.Employee_Name || "" : "";
    };

    const agentName = (entry) => {
        const agent = entry && entry.agentId ? agentOf(entry.agentId) : null;
        return agent ? agent.name || "" : "";
    };

    const initialsOf = (name) => String(name || "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();

    return { people, agents, ensureAgents, personOf, agentOf, personName, agentName, initialsOf };
}

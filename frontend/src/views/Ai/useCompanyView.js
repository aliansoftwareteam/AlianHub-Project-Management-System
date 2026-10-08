import { computed, ref } from "vue";
import { fetchFlowBoard, fetchOrgChart } from "@/utils/dispatcher";

const orgChart = ref(null);
const flowBoard = ref(null);
let orgRead = null;


/* The org chart is read once and shared, so the sidebar's check for the dispatcher flag and the org chart panel make one read between them. */
const loadOrgChart = (force = false) => {
    if (!force && orgRead) return orgRead;
    orgRead = fetchOrgChart().then((data) => { orgChart.value = data || { on: false, blueprints: [] }; return orgChart.value; });
    orgRead.catch(() => { orgRead = null; });
    return orgRead;
};

const loadFlowBoard = async () => {
    flowBoard.value = (await fetchFlowBoard()) || { on: false, roles: [], unrouted: { count: 0, items: [] } };
    return flowBoard.value;
};

const forget = () => { orgRead = null; };

export function useCompanyView() {
    return {
        forget,
        orgChart,
        flowBoard,
        on: computed(() => orgChart.value?.on === true),
        loadOrgChart,
        loadFlowBoard,
    };
}

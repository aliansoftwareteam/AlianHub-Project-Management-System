import { computed, ref } from "vue";
import { fetchFlowBoard, fetchOrgChart } from "@/utils/dispatcher";

const orgChart = ref(null);
const flowBoard = ref(null);
let orgRead = null;
let readFor = null;

const currentCompany = () => {
    try { return localStorage.getItem("selectedCompany") || ""; } catch { return ""; }
};

/* The panels are shared across the app, so a switch of company drops what was read for the last one. */
const companyNow = () => {
    const companyId = currentCompany();
    if (companyId !== readFor) {
        readFor = companyId;
        orgRead = null;
        orgChart.value = null;
        flowBoard.value = null;
    }
    return companyId;
};

/* The org chart is read once per company and shared, so the sidebar's check for the dispatcher flag and the org chart panel make one read between them. */
const loadOrgChart = (force = false) => {
    const companyId = companyNow();
    if (!force && orgRead) return orgRead;
    const read = fetchOrgChart().then((data) => {
        const chart = data || { on: false, blueprints: [] };
        if (currentCompany() === companyId) orgChart.value = chart;
        return chart;
    });
    orgRead = read;
    read.catch(() => { if (orgRead === read) orgRead = null; });
    return read;
};

const loadFlowBoard = async () => {
    const companyId = companyNow();
    const board = (await fetchFlowBoard()) || { on: false, roles: [], unrouted: { count: 0, items: [] } };
    if (currentCompany() === companyId) flowBoard.value = board;
    return board;
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

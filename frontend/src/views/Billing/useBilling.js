import { reactive, ref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";

// Shared state and formatting for the Billing screens (handoff 19a–19d).
//
// Money arrives from the API as integer minor units and is only ever divided
// for display — the browser never adds two amounts, so nothing here can drift.

export const fromMinor = (minor) => (Number(minor) || 0) / 100;

export const money = (minor, symbol = "$") => {
    const value = fromMinor(minor);
    const body = Math.abs(value)
        .toFixed(Math.abs(value) % 1 === 0 ? 0 : 2)
        .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${value < 0 ? "-" : ""}${symbol}${body}`;
};

export const percentFromBp = (bp) => (bp === null || bp === undefined ? null : Math.round(Number(bp) / 100));

export const hoursFromMinutes = (minutes) => Math.round((Number(minutes) || 0) / 60);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const dayLabel = (value) => {
    if (!value) return "";
    const date = typeof value === "number" ? new Date(value) : new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
};

export const isoDay = (value) => {
    if (!value) return "";
    const date = typeof value === "number" ? new Date(value) : new Date(String(value));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

export const currentMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export const monthLabel = (month) => {
    const match = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
    if (!match) return "";
    return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`.toUpperCase();
};

const payload = (res) => (res && res.data) || {};

export function useBilling(projectId) {
    const contract = reactive({ loading: false, error: "", data: null });
    const hourly = reactive({ loading: false, error: "", data: null, month: currentMonth() });
    const invoices = reactive({ loading: false, error: "", list: [] });
    const clientView = reactive({ loading: false, error: "", data: null });
    const saving = ref(false);

    const loadContract = async () => {
        contract.loading = true;
        contract.error = "";
        try {
            const body = payload(await apiRequest("get", `${env.BILLING_CONTRACT}?projectId=${projectId}`));
            if (!body.status) throw new Error(body.statusText || "");
            contract.data = body.data;
        } catch (error) {
            contract.error = error.message || "load_failed";
        } finally {
            contract.loading = false;
        }
    };

    const saveContract = async (patch) => {
        saving.value = true;
        try {
            const body = payload(await apiRequest("put", env.BILLING_CONTRACT, { projectId, ...patch }));
            if (!body.status) return { ok: false, message: body.statusText || "" };
            await loadContract();
            return { ok: true, message: body.statusText || "" };
        } catch (error) {
            return { ok: false, message: error.message || "" };
        } finally {
            saving.value = false;
        }
    };

    const addMilestone = async (fields) => {
        saving.value = true;
        try {
            const body = payload(await apiRequest("post", env.BILLING_MILESTONE, { projectId, ...fields }));
            if (!body.status) return { ok: false, message: body.statusText || "" };
            await loadContract();
            return { ok: true, message: body.statusText || "" };
        } catch (error) {
            return { ok: false, message: error.message || "" };
        } finally {
            saving.value = false;
        }
    };

    const patchMilestone = async (id, fields) => {
        saving.value = true;
        try {
            const body = payload(await apiRequest("patch", `${env.BILLING_MILESTONE}/${id}`, { projectId, ...fields }));
            if (!body.status) return { ok: false, message: body.statusText || "" };
            await loadContract();
            return { ok: true, message: body.statusText || "" };
        } catch (error) {
            return { ok: false, message: error.message || "" };
        } finally {
            saving.value = false;
        }
    };

    const loadHourly = async (month) => {
        hourly.loading = true;
        hourly.error = "";
        if (month) hourly.month = month;
        try {
            const body = payload(await apiRequest("get", `${env.BILLING_HOURLY}?projectId=${projectId}&month=${hourly.month}`));
            if (!body.status) throw new Error(body.statusText || "");
            hourly.data = body.data;
        } catch (error) {
            hourly.error = error.message || "load_failed";
        } finally {
            hourly.loading = false;
        }
    };

    const loadInvoices = async () => {
        invoices.loading = true;
        invoices.error = "";
        try {
            const body = payload(await apiRequest("get", `${env.PROJECT_INVOICES}?projectId=${projectId}`));
            if (!body.status) throw new Error(body.statusText || "");
            invoices.list = body.data || [];
        } catch (error) {
            invoices.error = error.message || "load_failed";
        } finally {
            invoices.loading = false;
        }
    };

    const loadInvoice = async (id) => {
        try {
            const body = payload(await apiRequest("get", `${env.PROJECT_INVOICES}/${id}`));
            return body.status ? body.data : null;
        } catch (error) {
            return null;
        }
    };

    const mutateInvoice = async (method, path, data) => {
        saving.value = true;
        try {
            const body = payload(await apiRequest(method, path, data));
            if (!body.status) return { ok: false, message: body.statusText || "" };
            await loadInvoices();
            return { ok: true, message: body.statusText || "", data: body.data };
        } catch (error) {
            return { ok: false, message: error.message || "" };
        } finally {
            saving.value = false;
        }
    };

    const draftFromMilestone = (milestoneId) => mutateInvoice("post", `${env.PROJECT_INVOICES}/draft-from-milestone`, { projectId, milestoneId });
    const draftFromMonth = (month) => mutateInvoice("post", `${env.PROJECT_INVOICES}/draft-from-month`, { projectId, month });
    const updateInvoice = (id, fields) => mutateInvoice("put", `${env.PROJECT_INVOICES}/${id}`, fields);
    const sendInvoice = (id) => mutateInvoice("post", `${env.PROJECT_INVOICES}/${id}/send`, {});
    const markPaid = (id) => mutateInvoice("post", `${env.PROJECT_INVOICES}/${id}/paid`, {});

    const loadClientView = async () => {
        clientView.loading = true;
        clientView.error = "";
        try {
            const body = payload(await apiRequest("get", `${env.BILLING_CLIENT_VIEW}?projectId=${projectId}`));
            if (!body.status) throw new Error(body.statusText || "");
            clientView.data = body.data;
        } catch (error) {
            clientView.error = error.message || "load_failed";
        } finally {
            clientView.loading = false;
        }
    };

    const sendClientMessage = async (message) => {
        try {
            const body = payload(await apiRequest("post", env.BILLING_CLIENT_MESSAGE, { projectId, message }));
            return { ok: Boolean(body.status), message: body.statusText || "" };
        } catch (error) {
            return { ok: false, message: error.message || "" };
        }
    };

    const shareLink = async () => {
        try {
            const body = payload(await apiRequest("post", env.PUBLIC_SHARES, { entityType: "client_view", entityId: projectId }));
            return body.status && body.data ? `${window.location.origin}/share/${body.data.token}` : "";
        } catch (error) {
            return "";
        }
    };

    return {
        contract,
        hourly,
        invoices,
        clientView,
        saving,
        loadContract,
        saveContract,
        addMilestone,
        patchMilestone,
        loadHourly,
        loadInvoices,
        loadInvoice,
        draftFromMilestone,
        draftFromMonth,
        updateInvoice,
        sendInvoice,
        markPaid,
        loadClientView,
        sendClientMessage,
        shareLink,
    };
}

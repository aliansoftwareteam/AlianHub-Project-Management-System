import { computed, ref } from "vue";
import { apiRequest, apiRequestWithoutCompnay } from "@/services";
import * as env from "@/config/env";

// Coding-agent accounts (27a-d) and the CLI setup panel (26a). Everything here
// reads from the endpoints that already exist; nothing is asserted that the
// backend does not actually store.

export const MODES = ["workspace", "personal", "local"];
export const PROVIDERS = ["claude-code", "cursor", "codex", "antigravity", "ollama", "vllm", "other"];

const account = ref(null);
const policy = ref({ allowedModes: [...MODES], requireCheckBeforeDone: false });
const summary = ref({});
const tokens = ref([]);
const manifest = ref({ protocolVersion: "", tools: [], never: [] });
const runs = ref([]);
const peopleHours = ref(null);

const ok = (res) => res?.data?.status === true;
const failure = (res, fallback) => res?.data?.statusText || res?.data?.message || fallback;
const thrown = (error, fallback) => error?.response?.data?.statusText || error?.response?.data?.message || error?.message || fallback;

export function useAccounts() {
    const mode = computed(() => (account.value && account.value.mode) || "");
    const allowed = computed(() => policy.value.allowedModes || []);
    const isAllowed = (m) => allowed.value.includes(m);

    const loadAccount = async () => {
        const res = await apiRequest("get", env.AGENT_ACCOUNT);
        if (!ok(res)) return;
        const data = res.data.data || {};
        account.value = data.account || null;
        if (data.policy) policy.value = data.policy;
        summary.value = data.summary || {};
    };

    const loadPolicy = async () => {
        const res = await apiRequest("get", env.AGENT_POLICY);
        if (ok(res)) policy.value = res.data.data || policy.value;
    };

    const loadTokens = async () => {
        const res = await apiRequest("get", env.API_TOKENS);
        tokens.value = ok(res) ? res.data.data || [] : [];
    };

    // Public and secret-free: the tool list and the never-list come from the
    // running server, never from a copy kept in the frontend.
    const loadManifest = async () => {
        try {
            const res = await apiRequestWithoutCompnay("get", env.MCP_MANIFEST);
            if (ok(res)) manifest.value = res.data.data || manifest.value;
        } catch (error) {
            manifest.value = { protocolVersion: "", tools: [], never: [] };
        }
    };

    const loadRuns = async () => {
        const res = await apiRequest("get", `${env.AGENT_RUNS}?limit=200`);
        runs.value = ok(res) ? res.data.data || [] : [];
    };

    /* The people half of the hours-by-source bar (27c). One number, because a
     * time log records who logged it and for how long and nothing that could
     * stand in for the agent `viaAccount` — that axis names the AI account a
     * model run was billed to, and a person's hours are not billed to one. */
    const loadPeopleHours = async (startSec, endSec) => {
        const range = Number.isFinite(startSec) && Number.isFinite(endSec)
            ? `?start=${Math.floor(startSec)}&end=${Math.floor(endSec)}`
            : "";
        try {
            const res = await apiRequest("get", `${env.TIMESHEET_HOURS_BY_SOURCE}${range}`);
            peopleHours.value = ok(res) ? Number(res.data.data?.peopleHours) || 0 : null;
        } catch (error) {
            peopleHours.value = null;
        }
    };

    const savePolicy = async (allowedModes) => {
        try {
            const res = await apiRequest("put", env.AGENT_POLICY, { allowedModes });
            if (!ok(res)) throw new Error(failure(res, "The policy was not saved."));
            policy.value = res.data.data || policy.value;
            return policy.value;
        } catch (error) {
            throw new Error(thrown(error, "The policy was not saved."));
        }
    };

    const linkAccount = async (body) => {
        try {
            const res = await apiRequest("put", env.AGENT_ACCOUNT, body);
            if (!ok(res)) throw new Error(failure(res, "The account was not linked."));
            account.value = res.data.data || null;
            return account.value;
        } catch (error) {
            throw new Error(thrown(error, "The account was not linked."));
        }
    };

    const unlinkAccount = async () => {
        try {
            const res = await apiRequest("delete", env.AGENT_ACCOUNT);
            if (!ok(res)) throw new Error(failure(res, "The account was not unlinked."));
            account.value = null;
            await loadTokens();
            return res.data.data || {};
        } catch (error) {
            throw new Error(thrown(error, "The account was not unlinked."));
        }
    };

    // The raw token comes back exactly once; the caller shows it and then loses it.
    const mintToken = async (body) => {
        try {
            const res = await apiRequest("post", env.MCP_TOKENS, body);
            if (!ok(res)) throw new Error(failure(res, "The token was not created."));
            await loadTokens();
            return res.data.data;
        } catch (error) {
            throw new Error(thrown(error, "The token was not created."));
        }
    };

    /* Deactivating rather than deleting is what keeps the audit trail: an
     * inactive token stops authenticating, and every row it wrote stays. */
    const revokeToken = async (tokenId) => {
        try {
            const res = await apiRequest("put", `${env.API_TOKENS}/${tokenId}`, { active: false });
            if (!ok(res)) throw new Error(failure(res, "The token was not revoked."));
            await loadTokens();
            return res.data.data;
        } catch (error) {
            throw new Error(thrown(error, "The token was not revoked."));
        }
    };

    return {
        account, policy, summary, tokens, manifest, runs, peopleHours,
        mode, allowed, isAllowed,
        loadAccount, loadPolicy, loadTokens, loadManifest, loadRuns, loadPeopleHours,
        savePolicy, linkAccount, unlinkAccount, mintToken, revokeToken
    };
}

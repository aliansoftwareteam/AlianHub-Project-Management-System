import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import Cookies from "js-cookie";
import { useCustomComposable } from "@/composable";
import { apiRequestWithoutCompnay, getAuth } from "@/services";
import * as env from "@/config/env";
import { connectAiWelcomePath } from "@/router/ai/connect";
import { isManagedHosting } from "@/config/publicConfig";

/* Creating a workspace, shared by the sign-up page (/business) and the in-app sidebar:
 * the plan's room, the name check, the create call with its progress stream, and opening the result. */
export function useCreateWorkspace(userId) {
    const { t, te } = useI18n();
    const router = useRouter();
    const { getters } = useStore();
    const { makeUniqueId } = useCustomComposable();

    const room = ref(null);
    const progress = ref(0);
    const statusText = ref("");
    const banner = ref("");
    const companies = computed(() => getters["settings/companies"] || []);

    // Self-hosted has no plan limit, so room stays null and nothing is shown.
    const loadRoom = () => {
        if (!isManagedHosting()) return Promise.resolve();
        return apiRequestWithoutCompnay("get", env.PLAN_WORKSPACES)
            .then((res) => { room.value = res?.data?.data?.managed ? res.data.data : null; })
            .catch(() => { room.value = null; });
    };

    const nameError = (raw) => {
        const name = (raw || "").trim();
        if (!name) return t("Auth.workspace_required");
        if (name.length < 3) return t("Auth.workspace_short");
        if (companies.value.some((x) => (x.Cst_CompanyName || "").toLowerCase().trim() === name.toLowerCase())) return t("Auth.workspace_taken");
        return "";
    };

    // The server names its reason by a code; its own sentence is English and stands in only for a code this build does not know.
    const failureMessage = ({ freeLimit, code, reason } = {}) => {
        if (freeLimit) return t("Auth.free_limit");
        const key = `Auth.workspace_reason_${code}`;
        const why = typeof code === "string" && te(key) ? t(key) : typeof reason === "string" ? reason : "";
        return why ? t("Auth.workspace_failed_reason", { reason: why }) : t("Auth.workspace_failed");
    };

    /* Resolves true once the new workspace is opening (the page reloads into it), false with `banner` set on failure. */
    const create = ({ name, teamSize, teamFocus, withSample, referral = "", email = "" }) => new Promise((resolve) => {
        banner.value = "";
        progress.value = 8;
        statusText.value = t("Auth.creating_workspace");
        const evId = `ev_${makeUniqueId(12)}`;
        const source = new EventSource(`${env.API_URI}/company-create/events/${evId}`);
        let settled = false;
        const settle = (ok, outcome) => {
            source.close();
            if (settled) return;
            settled = true;
            outcome();
            resolve(ok);
        };
        const refuse = (why) => settle(false, () => {
            banner.value = failureMessage(why);
            progress.value = 0;
        });
        const openWorkspace = (newCompanyId) => settle(true, () => {
            progress.value = 100;
            statusText.value = t("Auth.workspace_ready");
            localStorage.setItem("selectedCompany", newCompanyId || "");
            localStorage.removeItem("isLogging");
            Cookies.remove("refferCode");
            // The session was issued before this workspace existed: without a new one its first requests are refused.
            const sessionRenewed = getAuth(userId.value).catch(() => null);
            setTimeout(() => {
                sessionRenewed.then(() => router.push(connectAiWelcomePath(newCompanyId))).then(() => window.location.reload());
            }, 600);
        });
        source.onmessage = (event) => {
            const data = JSON.parse(event.data)?.data;
            if (data?.step === 1) { progress.value = 35; statusText.value = t("Auth.creating_workspace"); return; }
            if (data?.step === 2) { progress.value = 70; statusText.value = t("Auth.seeding_sample"); return; }
            if (data?.error) refuse({ freeLimit: data.freeCompanyLimitReached, code: data.code, reason: data.error });
            else openWorkspace(data?.companyId);
        };
        // The stream only reports progress: the workspace may still be made, and the reply below says whether it was.
        source.onerror = () => source.close();

        apiRequestWithoutCompnay("post", env.CREATE_COMPANY, {
            userId: userId.value,
            email,
            companyName: name.trim(),
            teamSize,
            teamFocus: withSample ? teamFocus : "",
            seedSampleProject: withSample,
            refferalCode: referral,
            phoneNumber: "",
            country: "",
            city: "",
            state: "",
            countryCodeObj: {},
            logtimeDays: 8,
            totalProjects: 0,
            isInactive: false,
            isFree: true,
            subscriptionData: { storage: 0, trackers: 0, users: 5 },
            totalData: { storage: 0, trackers: 0, users: 1 },
            eventId: evId,
            Cst_countryCode: "",
            Cst_stateCode: ""
        }).then((res) => {
            if (res.data?.status === true) openWorkspace(res.data.companyId);
            else refuse({ freeLimit: res.data?.freeCompanyLimitReached, code: res.data?.code, reason: res.data?.statusText });
        }).catch((err) => {
            console.error("ERROR IN CREATE COMPANY", err);
            refuse();
        });
    });

    return { room, progress, statusText, banner, loadRoom, nameError, create };
}

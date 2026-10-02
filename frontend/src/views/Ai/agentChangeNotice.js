import { onBeforeUnmount, unref, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useToast } from "vue-toast-notification";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { showUndoToast, undoToast } from "@/composable/useUndoToast";
import { AGENTS_CHANGED_EVENT, APPLIED_CHANGE } from "./agentFeed";

/* The person's own connected agent changed something without waiting for approval. The signal carries the id
 * alone; what it was is read from the server, which answers this person only and leaves out what they cannot
 * open. Changes that arrive close together, or while the page is out of sight, are told as one notice. */

export const GATHER_MS = 600;
export const GATHER_MAX_MS = 2500;
const IDS_PER_READ = 50;
const TOAST = { position: "top-right" };

const tidy = (change) => ({ ...change, auditId: String(change.auditId), parts: (change.parts || []).map(String) });
const countOf = (change) => Math.max(1, change.parts.length);
const isOneChange = (change) => !change.parts.length && Boolean(change.label);

/* A batch stands for its parts, except a batch of one, which is shown as that one change. */
const withoutDoubles = (changes) => {
    const ids = new Set(changes.map((change) => change.auditId));
    const kept = changes.filter((change) => !(change.parts.length === 1 && ids.has(change.parts[0])));
    const covered = new Set(kept.flatMap((change) => change.parts));
    return kept.filter((change) => !covered.has(change.auditId));
};

const hidden = () => typeof document !== "undefined" && document.hidden === true;

// The socket and the company are passed in: the shell that provides them cannot inject them.
export function useAgentChangeNotice(socket, companyId) {
    const { t } = useI18n();
    const router = useRouter();
    const $toast = useToast();

    let bound = null;
    let waiting = new Set();
    let firstAt = 0;
    let timer = null;
    let shown = [];
    let noticeId = 0;

    const company = () => String(unref(companyId) || "");

    const undo = async (change) => {
        try {
            const res = await apiRequest("post", `${env.AUDIT_LOGS}/${change.auditId}/undo`, {});
            if (!res?.data?.status) throw new Error(res?.data?.statusText || t("AgentChange.undo_failed"));
            const items = res.data.data?.items;
            const done = Array.isArray(items) ? items.filter((item) => item.ok).length : 0;
            if (Array.isArray(items) && done < items.length) $toast.error(t("AgentChange.undone_some", { done, n: items.length }), TOAST);
            else $toast.success(t("AgentChange.undone"), TOAST);
        } catch (e) {
            $toast.error(e?.response?.data?.statusText || e?.message || t("AgentChange.undo_failed"), TOAST);
        }
    };

    const openList = () => router.push({ name: "AuditLog", params: { cid: company() }, query: { scope: "agent" } }).catch(() => {});

    const show = (canList) => {
        const [only] = shown;
        const alone = shown.length === 1;
        const total = shown.reduce((sum, change) => sum + countOf(change), 0);
        const agent = new Set(shown.map((change) => change.agentName)).size === 1 ? only.agentName : "";
        const single = alone && isOneChange(only);
        let message = agent ? t("AgentChange.many", { agent, n: total }, total) : t("AgentChange.many_mixed", { n: total }, total);
        if (single) message = only.name ? t("AgentChange.one", { agent, task: only.name, what: only.label }) : t("AgentChange.one_unnamed", { agent, what: only.label });
        noticeId = showUndoToast({
            message,
            wrap: true,
            undo: alone && only.undoable ? () => undo(only) : null,
            action: !single && canList ? { label: t("AgentChange.show"), run: openList } : null
        });
    };

    async function read() {
        timer = null;
        const ids = [...waiting].slice(0, IDS_PER_READ);
        ids.forEach((id) => waiting.delete(id));
        if (waiting.size) schedule();
        if (!ids.length) return;
        let data = null;
        try {
            const res = await apiRequest("get", `${env.AGENT_CHANGES}?ids=${encodeURIComponent(ids.join(","))}`, undefined, undefined, { background: true });
            if (res?.data?.status === true) data = res.data.data;
        } catch (e) {
            return;
        }
        const fresh = ((data && data.changes) || []).map(tidy);
        if (!fresh.length) return;
        const stillUp = Boolean(undoToast.current) && undoToast.current.id === noticeId;
        const known = stillUp ? shown : [];
        const seen = new Set(known.map((change) => change.auditId));
        shown = withoutDoubles([...known, ...fresh.filter((change) => !seen.has(change.auditId))]);
        show(data.canList === true);
    }

    function schedule() {
        clearTimeout(timer);
        timer = null;
        if (hidden()) return;
        const now = Date.now();
        timer = setTimeout(read, Math.max(0, Math.min(GATHER_MS, firstAt + GATHER_MAX_MS - now)));
    }

    const onChanged = (change) => {
        if (change?.kind !== APPLIED_CHANGE || !change.auditId || String(change.companyId || "") !== company()) return;
        if (!waiting.size) firstAt = Date.now();
        waiting.add(String(change.auditId));
        schedule();
    };

    const onVisibility = () => {
        if (!waiting.size) return;
        firstAt = Date.now();
        schedule();
    };

    function unbind() {
        bound?.off?.(AGENTS_CHANGED_EVENT, onChanged);
        bound = null;
    }

    function bind() {
        const live = unref(socket);
        if (live === bound) return;
        unbind();
        if (!live?.on) return;
        bound = live;
        live.on(AGENTS_CHANGED_EVENT, onChanged);
    }

    watch(() => unref(socket), bind, { immediate: true });
    watch(() => company(), () => { waiting = new Set(); shown = []; clearTimeout(timer); timer = null; });
    document.addEventListener("visibilitychange", onVisibility);
    onBeforeUnmount(() => {
        unbind();
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
    });
}

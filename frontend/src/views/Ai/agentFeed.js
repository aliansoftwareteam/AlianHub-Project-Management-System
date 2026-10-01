import { computed, ref } from "vue";
import { apiRequest } from "@/services";
import { isBusy, retryAfterMs } from "@/services/busy";
import * as env from "@/config/env";
import { shellState } from "@/components/organisms/Shell/shellState";

/* The LIVE strip, the rail badge, the AI sidebar and the project pages all read agents from here,
 * so none of them can disagree and none of them sends a request of its own. The server's
 * agentsChanged signal asks for a refresh; the poll only covers a dropped socket and the people's
 * timers, which no agent event announces. */
export const AGENTS_CHANGED_EVENT = "agentsChanged";
const LIVE_POLL_MS = 30000;
const IDLE_POLL_MS = 120000;
const BURST_MS = 500;
const BURST_MAX_WAIT_MS = 3000;
const EVENT_GAP_MS = 5000;
const MAX_BACKOFF_MS = 300000;
const READ_TIMEOUT_MS = 20000;
const RUNS_SHOWN = 25;

export const people = ref([]);
export const agents = ref([]);
export const runs = ref([]);
export const openRuns = ref([]);
export const proposals = ref([]);
// A paused agent can still hold a run waiting on a person; the server counts it as paused, not live.
export const live = computed(() => agents.value.filter((a) => a.status === "running" && a.run));
export const running = computed(() => live.value.length);

const runHooks = new Set();
let subscribers = 0;
let proposalWatchers = 0;
let inFlight = null;
let again = false;
let stale = false;
let pollTimer = null;
let burstTimer = null;
let burstStartedAt = 0;
let lastCycleAt = 0;
let busyUntil = 0;
let busyStreak = 0;
let boundSocket = null;

const ok = (res) => res?.data?.status === true;
const hidden = () => typeof document !== "undefined" && document.hidden === true;
const get = (url) => apiRequest("get", url, undefined, undefined, { background: true });

// apiRequest never settles a request that abortAllRequests cancelled; without a limit one such read would stop the feed for good.
const within = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
});

const shared = (read) => {
    let pending = null;
    return () => {
        if (!pending) pending = within(read(), READ_TIMEOUT_MS).finally(() => { pending = null; });
        return pending;
    };
};

const readTeam = shared(async () => {
    const res = await get(env.AGENT_TEAM);
    if (!ok(res)) return;
    const data = res.data.data || {};
    people.value = data.people || [];
    agents.value = data.agents || [];
    shellState.agentsRunning = running.value;
});

const readRuns = shared(async () => {
    const res = await get(`${env.AGENT_RUNS}?limit=${RUNS_SHOWN}`);
    if (!ok(res)) return;
    runs.value = res.data.data || [];
    openRuns.value = res.data.summary?.runs || [];
    runHooks.forEach((hook) => hook(runs.value));
});

const readProposals = shared(async () => {
    const res = await get(`${env.AGENT_PROPOSALS}?status=pending`);
    if (ok(res)) proposals.value = res.data.data || [];
});

const agentsBusy = () => running.value > 0 || openRuns.value.length > 0;
const pollEvery = () => (agentsBusy() ? LIVE_POLL_MS : IDLE_POLL_MS);

const cycle = async () => {
    const reads = [readTeam(), readRuns()];
    if (proposalWatchers > 0) reads.push(readProposals());
    const results = await Promise.allSettled(reads);
    lastCycleAt = Date.now();
    const refusal = results.map((result) => result.reason).find(isBusy);
    if (!refusal) {
        busyStreak = 0;
        return;
    }
    busyStreak += 1;
    busyUntil = lastCycleAt + Math.min(MAX_BACKOFF_MS, Math.max(retryAfterMs(refusal) || 0, LIVE_POLL_MS * 2 ** busyStreak));
};

function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = null;
    if (!subscribers || hidden()) return;
    const dueAt = Math.max(lastCycleAt + pollEvery(), busyUntil);
    pollTimer = setTimeout(refreshAgentFeed, Math.max(0, dueAt - Date.now()));
}

export function refreshAgentFeed() {
    if (inFlight) {
        again = true;
        return inFlight;
    }
    clearTimeout(pollTimer);
    clearTimeout(burstTimer);
    pollTimer = null;
    burstTimer = null;
    again = false;
    stale = false;
    inFlight = cycle().finally(() => {
        inFlight = null;
        if (!subscribers) return;
        schedulePoll();
        if (again) onAgentsChanged();
    });
    return inFlight;
}

function onAgentsChanged() {
    if (!subscribers) return;
    if (inFlight) {
        again = true;
        return;
    }
    const now = Date.now();
    if (hidden() || now < busyUntil) {
        stale = true;
        return;
    }
    if (!burstTimer) burstStartedAt = now;
    clearTimeout(burstTimer);
    const startAt = Math.max(lastCycleAt + EVENT_GAP_MS, Math.min(now + BURST_MS, burstStartedAt + BURST_MAX_WAIT_MS));
    burstTimer = setTimeout(refreshAgentFeed, startAt - now);
}

function onVisibility() {
    if (hidden()) {
        if (burstTimer) stale = true;
        clearTimeout(pollTimer);
        clearTimeout(burstTimer);
        pollTimer = null;
        burstTimer = null;
        return;
    }
    if (stale && Date.now() >= busyUntil) refreshAgentFeed();
    else schedulePoll();
}

export function bindAgentSocket(socket) {
    const next = socket?.on ? socket : null;
    if (next === boundSocket) return;
    boundSocket?.off?.(AGENTS_CHANGED_EVENT, onAgentsChanged);
    boundSocket = next;
    boundSocket?.on(AGENTS_CHANGED_EVENT, onAgentsChanged);
}

function start() {
    document.addEventListener("visibilitychange", onVisibility);
    if (hidden() || Date.now() < busyUntil) {
        stale = true;
        schedulePoll();
    } else {
        refreshAgentFeed();
    }
}

function stop() {
    document.removeEventListener("visibilitychange", onVisibility);
    bindAgentSocket(null);
    clearTimeout(pollTimer);
    clearTimeout(burstTimer);
    pollTimer = null;
    burstTimer = null;
    again = false;
    stale = false;
}

const readNow = (read) => {
    if (hidden() || Date.now() < busyUntil) stale = true;
    else read().catch(() => {});
};

/* onRuns is handed the latest runs after every read of them, and once on joining if a read has
 * already landed. proposals: true is for the surfaces that show pending proposals; nobody else pays
 * for that read. Returns the function that ends the subscription. */
export function subscribeAgentFeed({ onRuns, proposals: wantsProposals = false } = {}) {
    const first = subscribers === 0;
    if (onRuns) runHooks.add(onRuns);
    if (wantsProposals) proposalWatchers += 1;
    subscribers += 1;
    if (first) start();
    else {
        if (onRuns && lastCycleAt) onRuns(runs.value);
        if (wantsProposals && proposalWatchers === 1) readNow(readProposals);
    }

    let released = false;
    return () => {
        if (released) return;
        released = true;
        if (onRuns) runHooks.delete(onRuns);
        if (wantsProposals) proposalWatchers -= 1;
        subscribers -= 1;
        if (subscribers === 0) stop();
    };
}

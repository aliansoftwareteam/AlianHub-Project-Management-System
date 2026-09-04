<template>
    <div class="pd ah-page">
        <header class="ah-toolbar pd__bar">
            <h1 class="ah-toolbar__title">{{ $t('Members.people') }}</h1>
            <span class="ah-mono pd__count">{{ $t('Members.people_count', { count: people.length, teams: teams.length }) }}</span>
            <div class="ah-toolbar__spacer"></div>
            <div v-if="mode === 'directory'" class="pd__search">
                <ShellIcon name="search" :size="15" />
                <input v-model.trim="search" class="pd__search-input" type="search" :placeholder="$t('Members.people_search_ph')" />
            </div>
            <div class="ah-tabs">
                <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'directory' }" @click="mode = 'directory'">{{ $t('Org.tab_directory') }}</button>
                <button type="button" class="ah-tab" :class="{ 'is-active': mode === 'org' }" @click="mode = 'org'">{{ $t('Org.tab_org') }}</button>
            </div>
        </header>

        <div v-if="mode === 'org'" class="pd__body ah-scroll">
            <section v-for="root in orgRoots" :key="root.id" class="ah-card">
                <div class="ah-card__body org__tree">
                    <div v-for="row in root.rows" :key="row.id" class="org__row" :style="{ paddingLeft: row.indent }">
                        <span v-if="row.depth" class="org__branch"></span>
                        <span class="ah-avatar">
                            <img v-if="row.person.image" :src="row.person.image" :alt="row.person.name" />
                            <template v-else>{{ row.person.initial }}</template>
                        </span>
                        <span class="org__who">
                            <span class="org__name">{{ row.person.name }}</span>
                            <span class="ah-small">{{ row.person.subtitle }}</span>
                        </span>
                        <span v-if="row.reports" class="ah-chip ah-chip--mono">{{ $t('Org.reports_count', { count: row.reports }) }}</span>
                    </div>
                </div>
            </section>

            <div v-if="!people.length" class="ah-empty">{{ $t('Members.no_people') }}</div>
            <div v-else-if="!managedCount" class="ah-card">
                <div class="ah-card__body org__empty">
                    <div class="ah-label">{{ $t('Org.empty_title') }}</div>
                    <p class="ah-small org__empty-note">{{ canEditManager ? $t('Org.empty_editable') : $t('Org.empty_readonly') }}</p>
                    <button v-if="canEditManager" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="mode = 'directory'">{{ $t('Org.empty_action') }}</button>
                </div>
            </div>
            <p class="ah-small pd__privacy">{{ $t('Org.org_note') }}</p>
        </div>

        <div v-else class="pd__body ah-scroll">
            <div class="pd__grid">
                <section v-if="selected" class="ah-card pd__focus">
                    <div class="ah-card__body pd__focus-body">
                        <div class="pd__focus-head">
                            <span class="ah-avatar pd__avatar-lg">
                                <img v-if="selected.image" :src="selected.image" :alt="selected.name" />
                                <template v-else>{{ selected.initial }}</template>
                            </span>
                            <div class="pd__focus-who">
                                <div class="pd__focus-name">{{ selected.name }}</div>
                                <div class="ah-small">{{ selected.subtitle }}</div>
                            </div>
                            <span class="ah-dot" :class="dotClass(selected)" :title="statusTitle(selected)"></span>
                        </div>

                        <div v-if="selected.skills.length" class="pd__skills">
                            <span v-for="skill in selected.skills" :key="skill.slug" class="pd__skill">{{ skill.name }}</span>
                        </div>
                        <p v-else class="ah-small">{{ $t('Members.no_skills') }}</p>

                        <div class="pd__stats">
                            <div v-if="canSeeLoad && selected.loadPct !== null" class="pd__stat">
                                <div class="pd__stat-n">{{ selected.loadPct }}%</div>
                                <div class="ah-small">{{ $t('Members.loaded') }}</div>
                            </div>
                            <div class="pd__stat">
                                <div class="pd__stat-n">{{ selected.openTasks }}</div>
                                <div class="ah-small">{{ $t('Members.open_tasks') }}</div>
                            </div>
                            <div class="pd__stat">
                                <div class="pd__stat-n">{{ selected.projects }}</div>
                                <div class="ah-small">{{ $t('Members.in_projects') }}</div>
                            </div>
                        </div>

                        <div v-if="canEditManager" class="ah-field">
                            <label class="ah-field__label" :for="`pd-manager-${selected.id}`">{{ $t('Org.reports_to') }}</label>
                            <select
                                :id="`pd-manager-${selected.id}`"
                                class="ah-input"
                                :class="{ 'ah-input--error': managerError }"
                                :value="selected.managerId"
                                :disabled="savingManager"
                                @change="setManager(selected, $event.target.value)"
                            >
                                <option value="">{{ $t('Org.no_manager') }}</option>
                                <option v-for="option in managerOptions" :key="option.id" :value="option.id">{{ option.name }}</option>
                            </select>
                            <span v-if="managerError" class="ah-field__error">{{ managerError }}</span>
                        </div>
                        <p v-else-if="selected.managerName" class="ah-small">{{ $t('Org.reports_to_name', { name: selected.managerName }) }}</p>

                        <div class="pd__actions">
                            <button v-if="hasChat" type="button" class="ah-btn ah-btn--outline ah-btn--sm" @click="goChat()">{{ $t('Members.message') }}</button>
                            <button v-if="canSeeLoad" type="button" class="ah-btn ah-btn--secondary ah-btn--sm" @click="goWorkload()">{{ $t('Members.their_work') }}</button>
                        </div>
                    </div>
                </section>

                <div class="pd__list">
                    <button
                        v-for="person in filtered"
                        :key="person.id"
                        type="button"
                        class="ah-card pd__row"
                        :class="{ 'is-selected': selectedId === person.id }"
                        @click="selectedId = person.id"
                    >
                        <span class="ah-avatar ah-avatar--lg">
                            <img v-if="person.image" :src="person.image" :alt="person.name" />
                            <template v-else>{{ person.initial }}</template>
                        </span>
                        <span class="pd__row-who">
                            <span class="pd__row-name">{{ person.name }}</span>
                            <span class="ah-small">{{ person.line }}</span>
                        </span>
                        <span class="ah-dot" :class="dotClass(person)" :title="statusTitle(person)"></span>
                    </button>
                    <div v-if="!filtered.length" class="ah-empty">{{ $t('Members.no_people') }}</div>
                </div>
            </div>

            <section v-if="allSkills.length" class="ah-card">
                <div class="ah-card__body pd__find">
                    <div class="ah-label">{{ $t('Members.find_someone') }}</div>
                    <div class="pd__find-chips">
                        <button
                            v-for="skill in allSkills"
                            :key="skill.slug"
                            type="button"
                            class="pd__find-chip"
                            :class="{ 'is-on': search.toLowerCase() === skill.name.toLowerCase() }"
                            @click="search = search.toLowerCase() === skill.name.toLowerCase() ? '' : skill.name"
                        >{{ skill.name }}</button>
                    </div>
                    <p class="ah-small pd__note">{{ $t('Members.skills_note') }}</p>
                </div>
            </section>

            <p class="ah-small pd__privacy">{{ $t('Members.privacy_note') }}</p>
        </div>
    </div>
</template>

<script setup>
import { computed, inject, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";
import { useCustomComposable } from "@/composable";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { memberData } from "@/views/Settings/Members/helperMember.js";

defineOptions({ name: "PeopleDirectory" });

const { t } = useI18n();
const router = useRouter();
const { getters, commit } = useStore();
const { checkPermission } = useCustomComposable();
const { getCompanyUsers } = memberData();
const companyId = inject("$companyId");
const userId = inject("$userId");

const HOURS_PER_DAY = 8;
const WINDOW_DAYS = 14;
const OWNER_ROLE = 1;
const ADMIN_ROLE = 2;
const MAX_DEPTH = 6;

const search = ref("");
const mode = ref("directory");
const selectedId = ref("");
const managerError = ref("");
const savingManager = ref(false);
const listing = ref([]);
const loadByUser = ref({});
const ptoByUser = ref({});
const workByUser = ref({});

// The mock's own rule: load figures belong to whoever can already see timesheets.
const canSeeLoad = computed(() => checkPermission("sheet_settings.workload_timesheet") !== null);
const hasChat = computed(() => router.hasRoute("chats") && checkPermission("chat") !== null);

const designations = computed(() => getters["settings/designations"] || []);
const rolesGetter = computed(() => getters["settings/roles"] || []);
const teamsGetter = computed(() => getters["settings/teams"] || []);
const projectSkills = computed(() => getters["settings/projectSkills"] || []);
const projects = computed(() => getters["projectData/onlyActiveProjects"]?.data || []);

const teams = computed(() => teamsGetter.value.filter((team) => (team.assigneeUsersArray || []).length));

function skillsFor(userIdValue) {
    const slugs = new Set();
    projects.value.forEach((project) => {
        if (!(project.AssigneeUserId || []).includes(userIdValue)) return;
        (project.skills || []).forEach((slug) => slugs.add(slug));
    });
    return [...slugs]
        .map((slug) => projectSkills.value.find((s) => s.slug === slug) || { slug, name: slug })
        .filter((skill) => skill.active !== false);
}

function teamsFor(userIdValue) {
    return teamsGetter.value.filter((team) => (team.assigneeUsersArray || []).includes(userIdValue)).map((team) => team.name);
}

function designationName(key) {
    return designations.value.find((d) => d.key === key)?.name || "";
}

function roleName(key) {
    return rolesGetter.value.find((r) => r.key === key)?.name || "";
}

// Guests are deliberately absent, as are pending invites and removed people.
const people = computed(() => listing.value
    .filter((u) => u.status === 2 && !u.isDelete && u.roleType !== 0 && !u.ghostUser)
    .map((u) => {
        const id = String(u.userId || "");
        const pto = ptoByUser.value[id];
        const load = loadByUser.value[id];
        const work = workByUser.value[id] || { tasks: 0, projects: 0 };
        const parts = [designationName(u.designation) || roleName(u.roleType)];
        const team = teamsFor(id)[0];
        if (team) parts.push(team);
        if (pto) parts.push(t("Members.on_pto", { date: pto }));
        return {
            id,
            requestId: String(u.requestId || u._id || ""),
            managerId: String(u.managerId || ""),
            name: u.Employee_Name || u.userEmail,
            image: u.Employee_profileImageURL || "",
            initial: (u.Employee_Name || u.userEmail || "?").trim().charAt(0).toUpperCase(),
            subtitle: parts.filter(Boolean).join(" · "),
            line: canSeeLoad.value && load !== undefined
                ? `${parts.filter(Boolean).join(" · ")} · ${load}%`
                : parts.filter(Boolean).join(" · "),
            skills: skillsFor(id),
            loadPct: load === undefined ? null : load,
            openTasks: work.tasks,
            projects: work.projects,
            onPto: !!pto
        };
    })
    .sort((a, b) => a.name.localeCompare(b.name)));

const allSkills = computed(() => {
    const seen = new Map();
    people.value.forEach((person) => person.skills.forEach((skill) => seen.set(skill.slug, skill)));
    return [...seen.values()];
});

const filtered = computed(() => {
    const term = search.value.toLowerCase();
    if (!term) return people.value;
    return people.value.filter((person) => `${person.name} ${person.subtitle} ${person.skills.map((s) => s.name).join(" ")}`.toLowerCase().includes(term));
});

const selected = computed(() => {
    const person = filtered.value.find((p) => p.id === selectedId.value) || filtered.value[0] || null;
    if (!person) return null;
    const manager = people.value.find((p) => p.id === person.managerId);
    return { ...person, managerId: manager ? manager.id : "", managerName: manager ? manager.name : "" };
});

const myRoleType = computed(() => {
    const me = listing.value.find((u) => String(u.userId || "") === String(userId.value || ""));
    return me ? Number(me.roleType) : null;
});
const canEditManager = computed(() => myRoleType.value === OWNER_ROLE || myRoleType.value === ADMIN_ROLE);

// A manager cannot be someone already below the person, or the person themselves.
const managerOptions = computed(() => {
    if (!selected.value) return [];
    const barred = new Set([selected.value.id]);
    const stack = [selected.value.id];
    while (stack.length) {
        const current = stack.pop();
        people.value.forEach((person) => {
            if (person.managerId !== current || barred.has(person.id)) return;
            barred.add(person.id);
            stack.push(person.id);
        });
    }
    return people.value.filter((person) => !barred.has(person.id));
});

const managedCount = computed(() => {
    const known = new Set(people.value.map((person) => person.id));
    return people.value.filter((person) => person.managerId && known.has(person.managerId)).length;
});

/* Iterative on purpose: a cycle that somehow reached the client must break the
 * walk, not the tab. Anyone unreachable from a root is promoted to one. */
const orgRoots = computed(() => {
    if (!managedCount.value) return [];
    const known = new Set(people.value.map((person) => person.id));
    const nodes = new Map(people.value.map((person) => [person.id, { id: person.id, person, reports: [] }]));
    const childrenOf = new Map();
    const rootIds = [];

    people.value.forEach((person) => {
        const manager = person.managerId;
        if (manager && manager !== person.id && known.has(manager)) {
            if (!childrenOf.has(manager)) childrenOf.set(manager, []);
            childrenOf.get(manager).push(person.id);
        } else {
            rootIds.push(person.id);
        }
    });

    const visited = new Set(rootIds);
    const expand = (seed) => {
        const stack = [seed];
        while (stack.length) {
            const id = stack.pop();
            (childrenOf.get(id) || []).forEach((child) => {
                if (visited.has(child)) return;
                visited.add(child);
                nodes.get(id).reports.push(nodes.get(child));
                stack.push(child);
            });
        }
    };
    rootIds.forEach(expand);
    people.value.forEach((person) => {
        if (visited.has(person.id)) return;
        visited.add(person.id);
        rootIds.push(person.id);
        expand(person.id);
    });

    return rootIds.map((id) => {
        const rows = [];
        const stack = [{ node: nodes.get(id), depth: 0 }];
        while (stack.length) {
            const { node, depth } = stack.pop();
            rows.push({
                id: node.id,
                person: node.person,
                depth,
                indent: `${Math.min(depth, MAX_DEPTH) * 20}px`,
                reports: node.reports.length
            });
            for (let i = node.reports.length - 1; i >= 0; i -= 1) stack.push({ node: node.reports[i], depth: depth + 1 });
        }
        return { id, rows };
    });
});

async function setManager(person, nextManagerId) {
    managerError.value = "";
    savingManager.value = true;
    try {
        const response = await apiRequest("put", env.API_MEMBERS, { id: person.requestId, data: { managerId: nextManagerId } });
        if (!response.data?.status) {
            managerError.value = response.data?.statusText || t("Org.save_failed");
            return;
        }
        const saved = response.data.data;
        listing.value = listing.value.map((u) => (String(u.requestId || u._id) === String(person.requestId) ? { ...u, managerId: nextManagerId } : u));
        if (saved) {
            commit("settings/mutateCompanyUsers", {
                data: { ...saved, _id: saved._id, isCurrentUser: saved.userId === userId.value, requestId: saved._id },
                op: "modified"
            });
        }
    } catch (error) {
        managerError.value = error?.response?.data?.statusText || t("Org.save_failed");
    } finally {
        savingManager.value = false;
    }
}

function dotClass(person) {
    if (person.onPto) return "";
    if (person.loadPct === null) return "ah-dot--ok";
    if (person.loadPct > 100) return "ah-dot--danger";
    if (person.loadPct >= 80) return "ah-dot--warn";
    return "ah-dot--ok";
}

function statusTitle(person) {
    if (person.onPto) return t("Members.on_pto", { date: "" }).trim();
    return person.loadPct === null ? "" : `${person.loadPct}%`;
}

function goChat() {
    router.push({ name: "chats", params: { cid: companyId.value } });
}

function goWorkload() {
    if (router.hasRoute("Workload Timesheet")) router.push({ name: "Workload Timesheet", params: { cid: companyId.value } });
}

function windowDates() {
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + WINDOW_DAYS);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

async function loadCapacity() {
    if (!canSeeLoad.value) return;
    const { from, to } = windowDates();
    try {
        const res = await apiRequest("get", `${env.CAPACITY}?from=${from}&to=${to}&hoursPerDay=${HOURS_PER_DAY}`);
        const rows = res.data?.status ? (res.data.data?.users || []) : [];
        const map = {};
        rows.forEach((row) => { map[String(row.userId)] = Math.round(Number(row.utilizationPct) || 0); });
        loadByUser.value = map;
    } catch (error) {
        loadByUser.value = {};
    }
}

async function loadPto() {
    const { from, to } = windowDates();
    try {
        const res = await apiRequest("get", `${env.PTO}?status=approved&from=${from}&to=${to}&pageSize=50`);
        const rows = res.data?.status ? (res.data.data || []) : [];
        const map = {};
        rows.forEach((row) => {
            const end = new Date(row.endDate);
            if (Number.isNaN(end.getTime())) return;
            map[String(row.userId)] = end.toLocaleDateString(undefined, { weekday: "short" });
        });
        ptoByUser.value = map;
    } catch (error) {
        ptoByUser.value = {};
    }
}

async function loadWork() {
    const findQuery = [
        { $match: { deletedStatusKey: { $in: [0, undefined] }, statusType: { $ne: "close" } } },
        { $unwind: "$AssigneeUserId" },
        { $group: { _id: "$AssigneeUserId", tasks: { $sum: 1 }, projects: { $addToSet: "$ProjectID" } } },
        { $project: { tasks: 1, projects: { $size: "$projects" } } }
    ];
    try {
        const res = await apiRequest("post", `${env.TASK}/find`, { findQuery });
        const map = {};
        (res.data || []).forEach((row) => { map[String(row._id)] = { tasks: row.tasks || 0, projects: row.projects || 0 }; });
        workByUser.value = map;
    } catch (error) {
        workByUser.value = {};
    }
}

onMounted(() => {
    listing.value = getCompanyUsers();
    loadCapacity();
    loadPto();
    loadWork();
});
</script>

<style scoped>
.pd { display: flex; flex-direction: column; height: 100%; background: var(--canvas); color: var(--ink); font: var(--text-body); }
.pd__bar { gap: 10px; }
.pd__count { color: var(--ink-3); }
.pd__search {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-input);
    background: var(--surface);
    color: var(--ink-2);
}
.pd__search-input { border: 0; outline: none; background: transparent; color: var(--ink); font: 400 12.5px/1 var(--font-ui); width: 170px; }

.pd__body { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; }
.pd__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }

.pd__focus { border: 1.5px solid var(--brand-ring); }
.pd__focus-body { display: flex; flex-direction: column; gap: 9px; }
.pd__focus-head { display: flex; align-items: center; gap: 10px; }
.pd__avatar-lg { width: 38px; height: 38px; font-size: 14px; }
.pd__focus-who { flex: 1; min-width: 0; }
.pd__focus-name { font: 600 13.5px/1.3 var(--font-ui); }

.pd__skills { display: flex; gap: 4px; flex-wrap: wrap; }
.pd__skill {
    padding: 3px 8px;
    border-radius: var(--r-chip);
    background: rgba(0, 0, 0, .06);
    font: 500 11px/1.4 var(--font-ui);
    color: var(--ink-label);
}
:root[data-theme="dark"] .pd__skill { background: rgba(255, 255, 255, .1); }

.pd__stats { display: flex; gap: 16px; }
.pd__stat-n { font: 600 15px/1.2 var(--font-ui); }
.pd__actions { display: flex; gap: 6px; flex-wrap: wrap; }

.pd__list { display: flex; flex-direction: column; gap: 8px; }
.pd__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 13px;
    text-align: left;
    cursor: pointer;
    color: var(--ink);
    font: var(--text-body);
    transition: border-color var(--t-state) var(--ease);
}
.pd__row.is-selected { border-color: var(--brand); }
.pd__row-who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pd__row-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pd__find { display: flex; flex-direction: column; gap: 9px; }
.pd__find-chips { display: flex; gap: 5px; flex-wrap: wrap; }
.pd__find-chip {
    padding: 6px 11px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-input);
    background: var(--surface);
    color: var(--ink-label);
    font: 400 12px/1.2 var(--font-ui);
    cursor: pointer;
    transition: border-color var(--t-state) var(--ease), color var(--t-state) var(--ease);
}
.pd__find-chip.is-on { border-color: var(--brand); color: var(--brand); font-weight: 600; }
.org__tree { display: flex; flex-direction: column; gap: 2px; }
.org__row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 6px 0;
}
.org__branch { width: 10px; height: 1px; margin-left: -20px; background: var(--border); flex: none; }
.org__who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.org__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.org__empty { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.org__empty-note { margin: 0; line-height: 1.5; max-width: 62ch; }

.pd__note { margin: 0; line-height: 1.5; }
.pd__privacy { margin: 0; line-height: 1.5; }

@media (max-width: 1023px) {
    .pd__grid { grid-template-columns: 1fr; }
}
@media (max-width: 767px) {
    .pd__body { padding: 14px 12px; }
    .pd__search { width: 100%; }
    .pd__search-input { width: 100%; }
}
</style>

<template>
    <div class="pm ah-card">
        <div class="pm__row pm__row--head" :style="gridStyle" role="row">
            <span class="ah-label pm__perm" role="columnheader">{{ $t('SettingsV2.col_permission') }}</span>
            <span v-for="col in columns" :key="col.id" class="ah-label pm__cell" :class="{ 'pm__cell--agents': col.agents }" role="columnheader">{{ col.name }}</span>
        </div>

        <div v-if="!groups.length" class="ah-empty pm__empty">{{ $t('SettingsV2.matrix_empty') }}</div>

        <template v-for="group in groups" :key="group.parent._id">
            <div class="pm__group" :style="gridStyle" role="row">
                <span class="ah-label pm__group-name">{{ ruleName(group.parent) }} · {{ group.rows.length }}</span>
                <span class="pm__cell pm__static" v-for="col in fixedColumns" :key="col.id"><ShellIcon name="check" :size="14" /></span>
                <span v-for="role in editableRoles" :key="role.key" class="pm__cell">
                    <AhSwitch
                        small
                        :modelValue="value(group.parent, role) !== null"
                        :disabled="!planCondition"
                        :label="`${ruleName(group.parent)} · ${role.name}`"
                        @update:modelValue="(on) => setValue(group.parent, role, on ? true : null)"
                    />
                </span>
                <span class="pm__cell pm__agent">—</span>
            </div>

            <div v-if="group.parent.key === 'artificial_intelligence' && !aiPlanPermission" class="pm__upgrade">
                <span>{{ $t('AI.please_upgrade_plan_to_use_ai') }}</span>
                <router-link class="ah-btn ah-btn--primary ah-btn--sm" :to="{ name: 'Upgrade', params: { cid: companyId } }">{{ $t('Upgrades.upgrade_your_plan') }}</router-link>
            </div>

            <div
                v-else
                v-for="rule in group.rows"
                :key="rule._id"
                :id="rowId(rule)"
                class="pm__row"
                :class="{ 'pm__row--danger': isDestructive(rule) }"
                :style="gridStyle"
                role="row"
            >
                <span class="pm__perm" role="cell">
                    <span class="pm__perm-name">{{ ruleName(rule) }}</span>
                    <span v-if="rule.desc" class="ah-small pm__perm-desc">{{ rule.desc }}</span>
                </span>
                <span v-for="col in fixedColumns" :key="col.id" class="pm__cell pm__static" role="cell"><ShellIcon name="check" :size="14" /></span>
                <span v-for="role in editableRoles" :key="role.key" class="pm__cell" role="cell">
                    <template v-if="rule.key === 'per_user_generate_limit'">
                        <input
                            type="number"
                            class="ah-input pm__num"
                            :value="numberValue(rule, role)"
                            :min="minLimit"
                            :max="maxLimit === null ? undefined : maxLimit"
                            :disabled="cellDisabled(rule, role)"
                            :aria-label="`${ruleName(rule)} · ${role.name}`"
                            @change="setValue(rule, role, Number($event.target.value))"
                        />
                    </template>
                    <template v-else-if="rule.selectionField">
                        <select class="pm__select" :value="String(value(rule, role))" :disabled="cellDisabled(rule, role)" :aria-label="`${ruleName(rule)} · ${role.name}`" @change="setValue(rule, role, parseOption($event.target.value))">
                            <option value="null">{{ $t('Permissions.None') }}</option>
                            <option v-if="rule.key === 'task_estimated_hours'" value="false">{{ $t('Permissions.Read') }}</option>
                            <option value="1">{{ $t('Permissions.own') }}</option>
                            <option value="2">{{ $t('Projects.everyone') }}</option>
                        </select>
                    </template>
                    <template v-else-if="mode === 'simple'">
                        <AhSwitch
                            small
                            :modelValue="value(rule, role) === true"
                            :disabled="cellDisabled(rule, role)"
                            :label="`${ruleName(rule)} · ${role.name}`"
                            @update:modelValue="(on) => setValue(rule, role, on ? true : null)"
                        />
                    </template>
                    <template v-else>
                        <select class="pm__select" :value="String(value(rule, role))" :disabled="cellDisabled(rule, role)" :aria-label="`${ruleName(rule)} · ${role.name}`" @change="setValue(rule, role, parseOption($event.target.value))">
                            <option value="null">{{ $t('Permissions.None') }}</option>
                            <option value="false">{{ $t('Permissions.Read') }}</option>
                            <option value="true">{{ $t('Permissions.Write') }}</option>
                        </select>
                    </template>
                </span>
                <span class="pm__cell pm__agent" role="cell">
                    <span v-if="isDestructive(rule)" class="pm__never">{{ $t('SettingsV2.agent_never') }}</span>
                    <span v-else-if="agentMode(rule) === 'proposes'" class="ah-chip ah-chip--warn ah-chip--mono">{{ $t('SettingsV2.agent_proposes') }}</span>
                    <span v-else-if="agentMode(rule) === 'read'" class="pm__read">{{ $t('SettingsV2.agent_read') }}</span>
                    <span v-else class="pm__dash">—</span>
                </span>
            </div>
        </template>
    </div>
</template>

<script setup>
import { computed, inject } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import AhSwitch from "@/components/molecules/Setting/AhSwitch.vue";
import ShellIcon from "@/components/organisms/Shell/ShellIcon.vue";

defineOptions({ name: "PermissionMatrix" });

const props = defineProps({
    searchValue: { type: String, default: "" },
    withoutOwnerRoles: { type: Array, default: () => [] },
    advancedPermissionBody: { type: Array, default: () => [] },
    changeRule: { type: Function, required: true },
    from: { type: String, default: "" },
    planCondition: { type: Boolean, default: false },
    mode: { type: String, default: "simple" },
    simpleKeys: { type: Array, default: () => [] }
});

const { t, te } = useI18n();
const { getters } = useStore();
const companyId = inject("$companyId");

const DESTRUCTIVE_RE = /delete|archive/;
const PROPOSES_RE = /create|edit|status|assignee|priority|due_date|start_date|tag|move|duplicate|merge|convert|comment|sprint|folder|milestone|custom_field|checklist|attachments|description|estimate|type/;
const READ_RE = /list|details|view|timesheet|report|activity_log|search|column|show_|projects$/;
const ROLE_ORDER = { 3: 0, 0: 1 };

const currentCompany = computed(() => getters["settings/selectedCompany"] || {});
const aiPlanPermission = computed(() => !!currentCompany.value.planFeature?.aiPermission);
const maxLimit = computed(() => (currentCompany.value.planFeature?.aiRequest === undefined ? 0 : currentCompany.value.planFeature.aiRequest));
const minLimit = computed(() => (currentCompany.value.planFeature?.aiRequest === null ? -1 : 0));

const fixedColumns = computed(() => [
    { id: "owner", name: t("SettingsV2.role_owner") },
    { id: "admin", name: t("SettingsV2.role_admin") }
]);
const editableRoles = computed(() => props.withoutOwnerRoles
    .filter((r) => r.key !== 2)
    .slice()
    .sort((a, b) => (ROLE_ORDER[a.key] ?? 9) - (ROLE_ORDER[b.key] ?? 9)));
const columns = computed(() => [
    ...fixedColumns.value,
    ...editableRoles.value.map((r) => ({ id: `role-${r.key}`, name: r.name })),
    { id: "agents", name: t("SettingsV2.role_agents"), agents: true }
]);
const gridStyle = computed(() => ({ gridTemplateColumns: `minmax(0, 1fr) repeat(${columns.value.length - 1}, 78px) 96px` }));

const ruleName = (rule) => (te(`SecurityAndPermission.${rule.key}`) ? t(`SecurityAndPermission.${rule.key}`) : rule.name);
const rowId = (rule) => `${String(rule.name || "").replaceAll(" ", "_")}${rule.key}`;
const isDestructive = (rule) => DESTRUCTIVE_RE.test(rule.key || "");
const agentMode = (rule) => (PROPOSES_RE.test(rule.key || "") ? "proposes" : READ_RE.test(rule.key || "") ? "read" : "none");

const entry = (rule, role) => (rule.roles || []).find((r) => r.key === role.key);
const value = (rule, role) => { const e = entry(rule, role); return e ? e.permission : null; };
const numberValue = (rule, role) => { const v = value(rule, role); return typeof v === "number" ? v : 0; };
const parseOption = (raw) => (raw === "null" ? null : raw === "false" ? false : raw === "true" ? true : Number(raw));

const byKey = computed(() => Object.fromEntries(props.advancedPermissionBody.map((r) => [r.key, r])));
function cellDisabled(rule, role) {
    if (!props.planCondition) return true;
    const dep = rule.dependency ? byKey.value[rule.dependency] : null;
    return !!dep && value(dep, role) === null;
}

function setValue(rule, role, next) {
    const prev = value(rule, role);
    const granting = next !== null && next !== false && (prev === null || prev === false);
    if (isDestructive(rule) && granting && role.key !== 1) {
        const ok = window.confirm(t("SettingsV2.confirm_destructive", { permission: ruleName(rule), role: role.name }));
        if (!ok) return;
    }
    props.changeRule(next, rule, role);
}

const matches = (rule) => {
    const q = props.searchValue.trim().toLowerCase();
    if (!q) return true;
    return ruleName(rule).toLowerCase().includes(q) || String(rule.desc || "").toLowerCase().includes(q) || String(rule.name || "").toLowerCase().includes(q);
};

const groups = computed(() => {
    const body = props.advancedPermissionBody;
    const simple = new Set(props.simpleKeys);
    return body.filter((r) => r.isParent).map((parent) => {
        const rows = body
            .filter((r) => !r.isParent && r.parentId === parent._id)
            .filter((r) => (props.mode === "simple" ? simple.has(r.key) : true))
            .filter(matches)
            .filter((r) => aiPlanPermission.value || r.dependency !== "artificial_intelligence");
        return { parent, rows };
    }).filter((g) => g.rows.length || (g.parent.key === "artificial_intelligence" && !aiPlanPermission.value && props.mode === "advanced"));
});
</script>

<style scoped>
.pm { overflow: hidden; font: var(--text-small); color: var(--ink); }
.pm__row { display: grid; gap: 8px; padding: 8px 16px; align-items: center; border-bottom: 1px solid var(--hairline); transition: background var(--t-state) var(--ease); }
.pm__row--head { padding: 10px 16px; }
.pm__row:last-child { border-bottom: 0; }
.pm__row--danger { background: var(--danger-bg); }
.pm__row--danger .pm__perm-name { color: var(--danger-ink); font-weight: 600; }
.pm__row.highlightRow { background: var(--brand-tint); }
.pm__group { display: grid; gap: 8px; padding: 8px 16px; align-items: center; background: var(--surface-2); border-bottom: 1px solid var(--hairline); }
.pm__group-name { color: var(--ink-label); }
.pm__perm { display: flex; flex-direction: column; min-width: 0; text-align: left; }
.pm__perm-name { font-weight: 500; }
.pm__perm-desc { line-height: 1.4; }
.pm__cell { display: flex; justify-content: center; align-items: center; text-align: center; }
.pm__cell--agents { color: var(--brand); }
.pm__static { color: var(--ok); }
.pm__select { height: 26px; max-width: 100%; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); font: 500 11.5px/1 var(--font-ui); padding: 0 4px; }
.pm__select:disabled, .pm__num:disabled { opacity: .5; }
.pm__num { width: 64px; height: 28px; padding: 0 6px; text-align: center; font-size: 12px; }
.pm__agent { font: var(--text-data); }
.pm__never { color: var(--danger-ink); font-weight: 600; text-decoration: line-through; }
.pm__read { color: var(--ok-ink); font-weight: 600; }
.pm__dash { color: var(--ink-3); }
.pm__empty { margin: 14px; }
.pm__upgrade { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--hairline); }
.pm__upgrade a { text-decoration: none; }
</style>

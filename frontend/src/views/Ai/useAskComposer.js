import { computed, nextTick, reactive, ref, unref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { MAX_CONTEXT, MENTION_MIN, connectorResults, connectorsOf, filterSkills, mentionAt, mentionResults, slashQuery, withNamedChips } from "./askComposer";

const SEARCH_DELAY_MS = 180;
export const MENU_ID = "ask-menu";

/* The `/` skill and `@` context menus of the Ask box. `question` is the box's model and `box` its element;
 * `skills` is the list the Skills popover shows. `label` names a connector by its provider id; `onConnect` is
 * called with an app the asker picked but has not connected. */
export function useAskComposer({ question, box, skills, label = (id) => id, onConnect = () => {} }) {
    const skill = ref(null);
    const chips = ref([]);
    const connectors = ref([]);
    const menu = reactive({ kind: "", items: [], active: 0, mention: null, searching: false, short: false });
    let dismissed = [];
    let timer = null;
    let searchSeq = 0;

    const loadConnectors = async () => {
        try {
            const res = await apiRequest("get", env.CONNECTORS);
            connectors.value = res?.data?.status ? connectorsOf(res.data.data, label) : [];
        } catch {
            connectors.value = [];
        }
    };

    const syncNamed = (text) => {
        const next = withNamedChips(chips.value, text, connectors.value, dismissed);
        const same = next.length === chips.value.length && next.every((chip, i) => chip === chips.value[i]);
        if (!same) chips.value = next;
    };

    const activeId = computed(() => (menu.kind && menu.items.length ? `${MENU_ID}-${menu.active}` : ""));

    const close = () => {
        clearTimeout(timer);
        searchSeq += 1;
        Object.assign(menu, { kind: "", items: [], active: 0, mention: null, searching: false, short: false });
    };

    const show = (kind, items) => Object.assign(menu, { kind, items, active: 0, searching: false });

    const search = (query) => {
        clearTimeout(timer);
        const seq = ++searchSeq;
        const apps = connectorResults(connectors.value, query, chips.value);
        if (query.length < MENTION_MIN) {
            Object.assign(menu, { kind: "mention", items: apps, active: 0, searching: false, short: true });
            return;
        }
        Object.assign(menu, { kind: "mention", items: apps, active: 0, searching: true, short: false });
        timer = setTimeout(async () => {
            let items = [];
            try {
                const res = await apiRequest("post", env.GLOBAL_SEARCH, { query });
                items = res?.data?.status ? mentionResults(res.data.data) : [];
            } catch {
                items = [];
            }
            if (seq !== searchSeq) return;
            show("mention", [...apps, ...items.filter((item) => !chips.value.some((chip) => chip.kind === item.kind && chip.id === item.id))]);
        }, SEARCH_DELAY_MS);
    };

    const onInput = () => {
        const el = unref(box);
        const text = el && typeof el.value === "string" ? el.value : unref(question);
        const mention = mentionAt(text, el && Number.isInteger(el.selectionStart) ? el.selectionStart : String(text || "").length);
        // The `@word` still being typed is the menu's to answer, not a name that adds a chip on its own.
        syncNamed(mention ? text.slice(0, mention.start) + text.slice(mention.end) : text);
        const slash = slashQuery(text);
        if (slash !== null) {
            show("skill", filterSkills(unref(skills), slash));
            return;
        }
        if (mention && chips.value.length < MAX_CONTEXT) {
            menu.mention = mention;
            search(mention.query);
            return;
        }
        close();
    };

    const focusAt = (caret) => nextTick(() => {
        const el = unref(box);
        if (!el) return;
        el.focus();
        if (Number.isInteger(caret) && typeof el.setSelectionRange === "function") el.setSelectionRange(caret, caret);
    });

    const pick = (item) => {
        if (!item) return;
        if (menu.kind === "skill") {
            skill.value = { key: item.id, name: item.title };
            question.value = "";
            close();
            focusAt(0);
            return;
        }
        const at = menu.mention;
        const text = String(unref(question) || "");
        const caret = at ? at.start : text.length;
        if (at) question.value = text.slice(0, at.start) + text.slice(at.end);
        close();
        if (item.kind === "connector" && !item.connected) {
            onConnect(item);
            return;
        }
        const same = (chip) => chip.kind === item.kind && chip.id === item.id;
        // A picked chip is the asker's own choice, so it stays when the name that may also have added it is cut.
        chips.value = chips.value.some(same)
            ? chips.value.map((chip) => (same(chip) ? { kind: chip.kind, id: chip.id, title: chip.title } : chip))
            : [...chips.value, { kind: item.kind, id: item.id, title: item.title }];
        focusAt(caret);
    };

    const move = (step) => {
        if (!menu.items.length) return;
        menu.active = (menu.active + step + menu.items.length) % menu.items.length;
    };

    /* True when the key belonged to the open menu, so the box must not also act on it. */
    const onKeydown = (event) => {
        if (!menu.kind || event.isComposing) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            move(event.key === "ArrowDown" ? 1 : -1);
            return true;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
            return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && menu.items.length) {
            event.preventDefault();
            pick(menu.items[menu.active]);
            return true;
        }
        if (event.key === "Enter" && menu.kind === "mention") close();
        return false;
    };

    const removeChip = (chip) => {
        chips.value = chips.value.filter((c) => !(c.kind === chip.kind && c.id === chip.id));
        if (chip.kind === "connector") dismissed = [...dismissed, chip.id];
        focusAt();
    };

    const clearSkill = () => {
        skill.value = null;
        focusAt();
    };

    const body = () => ({
        ...(skill.value ? { skill: skill.value.key } : {}),
        ...(chips.value.length ? { context: chips.value.map(({ kind, id }) => ({ kind, id })) } : {})
    });

    const reset = () => {
        skill.value = null;
        chips.value = [];
        dismissed = [];
        close();
    };

    return { skill, chips, connectors, menu, activeId, loadConnectors, onInput, onKeydown, pick, close, removeChip, clearSkill, body, reset, hover: (i) => { menu.active = i; } };
}

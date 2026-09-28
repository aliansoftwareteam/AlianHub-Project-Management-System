import { computed, nextTick, reactive, ref, unref } from "vue";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { MAX_CONTEXT, MENTION_MIN, filterSkills, mentionAt, mentionResults, slashQuery } from "./askComposer";

const SEARCH_DELAY_MS = 180;
export const MENU_ID = "ask-menu";

/* The `/` skill and `@` context menus of the Ask box. `question` is the box's model and `box` its element;
 * `skills` is the list the Skills popover shows. */
export function useAskComposer({ question, box, skills }) {
    const skill = ref(null);
    const chips = ref([]);
    const menu = reactive({ kind: "", items: [], active: 0, mention: null, searching: false, short: false });
    let timer = null;
    let searchSeq = 0;

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
        if (query.length < MENTION_MIN) {
            Object.assign(menu, { kind: "mention", items: [], active: 0, searching: false, short: true });
            return;
        }
        Object.assign(menu, { kind: "mention", searching: true, short: false });
        timer = setTimeout(async () => {
            let items = [];
            try {
                const res = await apiRequest("post", env.GLOBAL_SEARCH, { query });
                items = res?.data?.status ? mentionResults(res.data.data) : [];
            } catch {
                items = [];
            }
            if (seq !== searchSeq) return;
            show("mention", items.filter((item) => !chips.value.some((chip) => chip.kind === item.kind && chip.id === item.id)));
        }, SEARCH_DELAY_MS);
    };

    const onInput = () => {
        const el = unref(box);
        const text = el && typeof el.value === "string" ? el.value : unref(question);
        const slash = slashQuery(text);
        if (slash !== null) {
            show("skill", filterSkills(unref(skills), slash));
            return;
        }
        const mention = mentionAt(text, el && Number.isInteger(el.selectionStart) ? el.selectionStart : String(text || "").length);
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
        if (!chips.value.some((chip) => chip.kind === item.kind && chip.id === item.id)) chips.value = [...chips.value, { kind: item.kind, id: item.id, title: item.title }];
        const text = String(unref(question) || "");
        const caret = at ? at.start : text.length;
        if (at) question.value = text.slice(0, at.start) + text.slice(at.end);
        close();
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
        close();
    };

    return { skill, chips, menu, activeId, onInput, onKeydown, pick, close, removeChip, clearSkill, body, reset, hover: (i) => { menu.active = i; } };
}

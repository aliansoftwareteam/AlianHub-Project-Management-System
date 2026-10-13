import { computed, reactive } from "vue";
import moment from "moment";
import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { homeState } from "./homeState";
import { uid } from "./homeFormat";

const agenda = reactive({ reminders: [], feeds: [], loaded: false, loading: false });

export function useAgenda() {
    async function load(force = false) {
        if (agenda.loading || (agenda.loaded && !force)) return;
        agenda.loading = true;
        try {
            const [reminders, feeds] = await Promise.all([
                apiRequest("get", `${env.GENERAL_REMINDERS}?filter=upcoming`).catch(() => null),
                apiRequest("get", `${env.CALENDAR_FEED}/feeds`).catch(() => null)
            ]);
            agenda.reminders = reminders?.data?.status ? reminders.data.data || [] : [];
            agenda.feeds = feeds?.data?.status ? feeds.data.data || [] : [];
            agenda.loaded = true;
        } finally {
            agenda.loading = false;
        }
    }

    const connected = computed(() => agenda.feeds.length > 0);

    function itemsFor(day, tasks = []) {
        const start = moment(day).startOf("day");
        const end = start.clone().endOf("day");
        const inDay = (d) => moment(d).isBetween(start, end, null, "[]");
        const items = [];
        agenda.reminders
            .filter((r) => !r.isDone && r.remindAt && inDay(r.remindAt))
            .forEach((r) => items.push({
                id: `r-${r._id}`, kind: "reminder", title: r.title,
                start: moment(r.remindAt), end: moment(r.remindAt).add(30, "minutes")
            }));
        homeState.focusBlocks
            .filter((b) => inDay(b.start))
            .forEach((b) => items.push({ id: b.id, kind: "focus", title: b.title, start: moment(b.start), end: moment(b.end), removable: true }));
        tasks
            .filter((t) => t.startDate && inDay(t.startDate))
            .forEach((t) => {
                const s = moment(t.startDate);
                const e = t.DueDate && moment(t.DueDate).isAfter(s) && moment(t.DueDate).isSame(s, "day") ? moment(t.DueDate) : s.clone().add(1, "hour");
                items.push({ id: `t-${t._id}`, kind: "task", title: t.TaskName, start: s, end: e, task: t });
            });
        return items.sort((a, b) => a.start.valueOf() - b.start.valueOf());
    }

    function addFocus(start, hours = 2, title = "") {
        const s = moment(start);
        homeState.focusBlocks.push({ id: `f-${uid()}`, title, start: s.toISOString(), end: s.clone().add(hours, "hours").toISOString() });
    }

    function removeFocus(id) {
        homeState.focusBlocks = homeState.focusBlocks.filter((b) => b.id !== id);
    }

    return { agenda, load, connected, itemsFor, addFocus, removeFocus };
}

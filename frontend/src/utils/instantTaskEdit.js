import { useToast } from "vue-toast-notification";
import Store from "@/store/index";
import { i18n } from "@/locales/main";
import { locate } from "@/store/ProjectData/taskTree";
import { holdOwnEdit } from "@/utils/taskUpdateMarker";

const listeners = new Set();

/* A view that keeps its own copy of a task hears every edit this tab makes, and the old values when one fails. */
export function onInstantEdit(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function storedRow(task) {
    const bucket = Store.state?.projectData?.tasks?.[task.ProjectID]?.[task.sprintId];
    return bucket ? locate(bucket, task._id)?.row : null;
}

function show(task, fields) {
    Store.commit("projectData/mutateUpdateFirebaseTasks", {
        snap: null, op: "modified", pid: task.ProjectID, sprintId: task.sprintId, data: { ...task, ...fields }, updatedFields: { ...fields }
    });
    listeners.forEach((listener) => listener(task._id, fields));
}

/* A refusal answers its reason as HTTP 400, or as status false on a 200. */
const reasonOf = (refusal) => refusal?.error?.response?.data?.statusText || refusal?.statusText || "";

/* Shows the change, sends it, and puts the old values back if the server does not take it.
   `failure` is the message shown then, unless the server gave its reason; without it the caller speaks. */
export function instantEdit({ task, fields, send, failure = "" }) {
    let edit;
    try {
        const stored = storedRow(task) || task;
        edit = holdOwnEdit(task._id, fields, Object.fromEntries(Object.keys(fields).map((field) => [field, stored[field]])));
        show(task, fields);
    } catch (error) {
        edit?.confirm();
        return Promise.reject({ status: false, error });
    }
    let sending;
    try {
        sending = send();
    } catch (error) {
        sending = Promise.reject({ status: false, error });
    }
    return sending.then((answer) => {
        edit.confirm();
        return answer;
    }, (refusal) => {
        const restore = edit.refuse();
        if (Object.keys(restore).length) show({ ...task, ...fields }, restore);
        const serverReason = reasonOf(refusal);
        if (failure) useToast().error(serverReason || i18n.global.t(failure), { position: "top-right" });
        throw { ...refusal, serverReason, announced: Boolean(failure) };
    });
}

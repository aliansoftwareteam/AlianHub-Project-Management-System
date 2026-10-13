import { apiRequest } from "@/services";
import * as env from "@/config/env";
import { distinct } from "./approvedProjectIds";

// No socket event tells a browser about a new project, so the page that approved one puts it in its own store,
// as the Create project screen does after its save. The read is the project route's own, so it answers only
// a person who may open the project.

const MUTATION = "projectData/mutateProjects";
const TRASHED = 1;

export async function showProjects(store, projectIds) {
    if (!store?.commit) return;
    for (const id of distinct(projectIds)) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const res = await apiRequest("get", `/api/v1/${env.PROJECTACTIONS}/${id}`);
            const project = res?.data;
            if (project?._id && project.deletedStatusKey !== TRASHED) {
                store.commit(MUTATION, [{ snap: null, privateSnap: false, op: "added", data: { ...project, id: project._id, isExpanded: false } }]);
            }
        } catch (error) {
            console.error("ERROR in reading an approved project: ", error);
        }
    }
}

export function dropProjects(store, projectIds) {
    if (!store?.commit) return;
    distinct(projectIds).forEach((id) => store.commit(MUTATION, [{ op: "removed", data: { _id: id } }]));
}

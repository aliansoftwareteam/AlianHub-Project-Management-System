import { describe, it, expect } from "vitest";
import { permittedAssignees, selfAssignable, sprintOf, subtaskCreateAssignees } from "@/utils/assigneeOptions";

const COMPANY = ["u1", "u2", "u3", "u4", "me"];

// The four copies this module replaced, transcribed verbatim, so every case they already
// handled can be checked for the same answer.
function legacyPermitted({ task, sprint, project, parentAssignees, companyUsers }) {
    let users = [];
    if (sprint) {
        if (task.isParentTask) {
            if (sprint.private) users = sprint.AssigneeUserId || [];
            else users = project?.isPrivateSpace ? (project.AssigneeUserId || []) : companyUsers;
        } else {
            users = sprint.private
                ? (parentAssignees || []).filter((x) => sprint.AssigneeUserId?.includes(x))
                : (parentAssignees || []);
        }
    }
    if (project?.isPrivateSpace) {
        users = users.filter((x) => project.AssigneeUserId.includes(x));
        return Array.from(new Set([...users, ...(task?.AssigneeUserId || [])]));
    }
    return users;
}

function legacySelf({ task, sprint, project, parentAssignees, userId }) {
    let users = [];
    if (sprint) {
        if (task.isParentTask) {
            if (sprint.private) users = (sprint.AssigneeUserId || []).filter((x) => x === userId);
            else users = project?.isPrivateSpace ? (project.AssigneeUserId || []).filter((x) => x === userId) : [userId];
        } else {
            users = (parentAssignees || []).filter((x) => x === userId);
            if (sprint.private) users = users.filter((x) => sprint.AssigneeUserId?.includes(x));
        }
    }
    if (project?.isPrivateSpace) users = users.filter((x) => project.AssigneeUserId.includes(x));
    return users;
}

const sprints = [
    { private: false },
    { private: true, AssigneeUserId: ["u1", "u2", "me"] },
];
const projects = [
    { isPrivateSpace: false },
    { isPrivateSpace: true, AssigneeUserId: ["u1", "u3", "me"] },
];

describe("assignee options", () => {
    it("gives a subtask of an unassigned parent the container's people instead of nobody", () => {
        const input = { task: { isParentTask: false }, sprint: sprints[0], project: projects[0], parentAssignees: [], companyUsers: COMPANY };
        expect(legacyPermitted(input)).toEqual([]);
        expect(permittedAssignees(input)).toEqual(COMPANY);
    });

    it("lets a member without full assignee permission take a subtask of an unassigned parent", () => {
        const input = { task: { isParentTask: false }, sprint: sprints[0], project: projects[0], parentAssignees: [], userId: "me" };
        expect(legacySelf(input)).toEqual([]);
        expect(selfAssignable(input)).toEqual(["me"]);
    });

    it("falls back when none of the parent's people are in the private sprint", () => {
        const input = { task: { isParentTask: false }, sprint: sprints[1], project: projects[0], parentAssignees: ["u4"], companyUsers: COMPANY };
        expect(permittedAssignees(input)).toEqual(["u1", "u2", "me"]);
    });

    it("keeps an assignee who has fallen out of scope removable", () => {
        const input = { task: { isParentTask: false, AssigneeUserId: ["u4"] }, sprint: sprints[0], project: projects[0], parentAssignees: ["u1"], companyUsers: COMPANY };
        expect(permittedAssignees(input)).toEqual(["u1", "u4"]);
    });

    it("answers exactly as before whenever the parent's people survive the scoping", () => {
        const parents = [["u1"], ["u1", "u3"], ["me", "u2"]];
        let checked = 0;
        for (const sprint of sprints) for (const project of projects) for (const isParentTask of [true, false]) for (const parentAssignees of parents) {
            const input = { task: { isParentTask }, sprint, project, parentAssignees, companyUsers: COMPANY, userId: "me" };
            const legacy = legacyPermitted(input);
            if (!isParentTask && !legacy.length) continue;
            expect(permittedAssignees(input)).toEqual(legacy);
            if (isParentTask || legacySelf(input).length) expect(selfAssignable(input)).toEqual(legacySelf(input));
            checked++;
        }
        expect(checked).toBeGreaterThan(10);
    });

    it("offers nothing new when the task's sprint cannot be found", () => {
        expect(permittedAssignees({ task: { isParentTask: true }, sprint: null, project: projects[0], companyUsers: COMPANY })).toEqual([]);
    });

    it("lets the subtask create row offer people when the parent is unassigned", () => {
        const project = { sprintsObj: { s1: { private: false } } };
        expect(subtaskCreateAssignees({ parent: { sprintId: "s1", AssigneeUserId: [] }, project, companyUsers: COMPANY })).toEqual(COMPANY);
        expect(subtaskCreateAssignees({ parent: { sprintId: "s1", AssigneeUserId: ["u2"] }, project, companyUsers: COMPANY })).toEqual(["u2"]);
    });

    it("keeps the create row's old answer when the host has no real project to resolve a sprint", () => {
        expect(subtaskCreateAssignees({ parent: { sprintId: "s1", AssigneeUserId: ["u2"] }, project: undefined, companyUsers: COMPANY })).toEqual(["u2"]);
    });

    it("finds a sprint inside a folder or at the project root", () => {
        const project = { sprintsObj: { s1: { id: "s1" } }, sprintsfolders: { f1: { sprintsObj: { s2: { id: "s2" } } } } };
        expect(sprintOf(project, { sprintId: "s1" })).toEqual({ id: "s1" });
        expect(sprintOf(project, { sprintId: "s2", folderObjId: "f1" })).toEqual({ id: "s2" });
        expect(sprintOf(project, { sprintId: "missing" })).toBeNull();
    });
});

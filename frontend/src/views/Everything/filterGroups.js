/* A group (a team) stands for its members: picking it picks them all, and it reads as picked once all are. */

export const groupState = (group, picked) => {
    const on = group.members.filter((value) => picked.includes(value)).length;
    if (!on) return "none";
    return on === group.members.length ? "all" : "some";
};

/* Taking a group out keeps the members that another fully picked group still holds. */
export const toggleGroup = (group, picked, groups = []) => {
    if (groupState(group, picked) !== "all") return [...new Set([...picked, ...group.members])];
    const kept = new Set(groups
        .filter((other) => other.value !== group.value && groupState(other, picked) === "all")
        .flatMap((other) => other.members));
    return picked.filter((value) => !group.members.includes(value) || kept.has(value));
};

export const groupMatching = (groups, picked) => (picked.length > 1
    ? groups.find((group) => group.members.length === picked.length && group.members.every((value) => picked.includes(value))) || null
    : null);

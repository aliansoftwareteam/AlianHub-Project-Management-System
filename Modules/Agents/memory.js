// Contract stub for the 017 workstreams; workstream B replaces this file.
const notYet = async () => null;

module.exports = {
    contextFor: async () => '',
    remember: notYet,
    recordEpisode: notYet,
    listProject: async () => ({ rows: [], episodes: [] }),
    listUser: async () => ({ preferences: {}, candidates: [] }),
    update: notYet,
    retire: notYet,
    preferenceCandidate: notYet,
    fromBrief: notYet,
    rememberApprovedChanges: notYet,
};

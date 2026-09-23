export const isAgentComment = (row) => !!row && (row.actorType === 'agent' || row.isAgent === true);

// An agent acting for a person stores that person's userId on the row; it still belongs on the agent's side.
export const isOnViewerSide = (row, viewerId) => !!row && row.userId === viewerId && !isAgentComment(row);

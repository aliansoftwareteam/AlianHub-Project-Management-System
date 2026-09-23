import { apiRequest } from '@/services';
import * as env from '@/config/env';

export const fetchPendingProposals = async () => {
    const res = await apiRequest('get', `${env.AGENT_PROPOSALS}?status=pending`);
    if (!res?.data?.status) throw new Error(res?.data?.statusText || 'Proposals did not load.');
    return res.data.data || [];
};

// Every surface decides through the agent API so the audit row, undo window and
// run closure are the same whichever page the person used.
export const sendProposalDecision = (proposalId, verb, body = {}) => apiRequest('post', `${env.AGENT_PROPOSALS}/${proposalId}/${verb}`, body);

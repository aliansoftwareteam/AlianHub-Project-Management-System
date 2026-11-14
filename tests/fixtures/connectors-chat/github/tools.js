const pull = {
    owner: { type: 'string', maxLength: 39 },
    repo: { type: 'string', maxLength: 100 },
    pullNumber: { type: 'integer', minimum: 1, maximum: 999999999 },
};

module.exports = [{
    key: 'github.pull_request.read',
    label: 'Connectors.tool.githubPullRequestRead',
    kind: 'read',
    product: 'repos',
    scope: 'repo',
    input: {
        type: 'object',
        description: 'One pull request the person can open: its state, checks and reviews.',
        properties: pull,
        required: ['owner', 'repo', 'pullNumber'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 4000 },
    run: async ({ input, connection }) => {
        const res = await connection.request(`https://api.github.test/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}`);
        const pr = JSON.parse(res.body);
        return `#${pr.number} ${pr.title}: ${pr.state}, checks ${pr.checks}`;
    },
}, {
    key: 'github.pull_request.comment',
    label: 'Connectors.tool.githubPullRequestComment',
    kind: 'write',
    product: 'repos',
    scope: 'repo',
    input: {
        type: 'object',
        description: 'Adds a comment to one pull request, as the person.',
        properties: { ...pull, body: { type: 'string', maxLength: 5000 } },
        required: ['owner', 'repo', 'pullNumber', 'body'],
        additionalProperties: false,
    },
    caps: { maxItems: 1, maxChars: 500 },
    card: (input) => ({ target: `${input.owner}/${input.repo}#${input.pullNumber}`, title: 'Comment', text: input.body }),
    run: async ({ input, connection }) => {
        await connection.request(`https://api.github.test/repos/${input.owner}/${input.repo}/issues/${input.pullNumber}/comments`, { method: 'post', json: { body: input.body } });
        return 'Commented';
    },
}];

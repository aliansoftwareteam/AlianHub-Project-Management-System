const { mcpTool } = require('../../mcpTools');

const repoFields = {
    owner: { type: 'string', maxLength: 100, description: 'The account or organisation that owns the repository.' },
    repo: { type: 'string', maxLength: 100, description: 'The repository name.' },
};
const pullNumber = { type: 'integer', minimum: 1, maximum: 100000000, description: 'The pull request number.' };
const issueNumber = { type: 'integer', minimum: 1, maximum: 100000000, description: 'The issue or pull request number.' };

/* Shapes are pinned with scripts/connector-tool-shapes.js and a test account; until then each tool stays off. The
 * AI chat's pull request rule (task 097) sends `github.pull_request.read` the input { owner, repo, pullNumber }. */
module.exports = [
    mcpTool({
        key: 'github.pull_request.read',
        label: 'Connectors.tool.githubPullRequestRead',
        kind: 'read',
        product: 'repos',
        input: {
            type: 'object',
            description: 'Reads one pull request the person can see on GitHub: title, state, author, branches and description.',
            properties: { ...repoFields, pullNumber },
            required: ['owner', 'repo', 'pullNumber'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 8000 },
        tool: 'pull_request_read',
        shape: null,
        args: (input) => ({ method: 'get', owner: input.owner, repo: input.repo, pullNumber: input.pullNumber }),
    }),
    mcpTool({
        key: 'github.pull_request.checks',
        label: 'Connectors.tool.githubPullRequestChecks',
        kind: 'read',
        product: 'repos',
        input: {
            type: 'object',
            description: 'Reads the status of the checks and builds on one pull request the person can see on GitHub.',
            properties: { ...repoFields, pullNumber },
            required: ['owner', 'repo', 'pullNumber'],
            additionalProperties: false,
        },
        caps: { maxItems: 50, maxChars: 6000 },
        tool: 'pull_request_read',
        shape: null,
        args: (input) => ({ method: 'get_status', owner: input.owner, repo: input.repo, pullNumber: input.pullNumber }),
    }),
    mcpTool({
        key: 'github.pull_requests.search',
        label: 'Connectors.tool.githubPullRequestsSearch',
        kind: 'read',
        product: 'repos',
        input: {
            type: 'object',
            description: 'Searches the pull requests the person can see on GitHub, with GitHub\'s search words such as repo:acme/web is:open.',
            properties: { query: { type: 'string', maxLength: 300, description: 'GitHub search words.' } },
            required: ['query'],
            additionalProperties: false,
        },
        caps: { maxItems: 20, maxChars: 8000 },
        tool: 'search_pull_requests',
        shape: null,
    }),
    mcpTool({
        key: 'github.issue.read',
        label: 'Connectors.tool.githubIssueRead',
        kind: 'read',
        product: 'repos',
        input: {
            type: 'object',
            description: 'Reads one issue the person can see on GitHub: title, state, labels and description.',
            properties: { ...repoFields, issueNumber },
            required: ['owner', 'repo', 'issueNumber'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 8000 },
        tool: 'issue_read',
        shape: null,
        args: (input) => ({ method: 'get', owner: input.owner, repo: input.repo, issue_number: input.issueNumber }),
    }),
    mcpTool({
        key: 'github.issue.comment',
        label: 'Connectors.tool.githubIssueComment',
        kind: 'write',
        product: 'repos',
        input: {
            type: 'object',
            description: 'Comments on an issue or pull request as the person, on GitHub.',
            properties: { ...repoFields, issueNumber, body: { type: 'string', maxLength: 20000, description: 'The comment, in Markdown.' } },
            required: ['owner', 'repo', 'issueNumber', 'body'],
            additionalProperties: false,
        },
        caps: { maxItems: 1, maxChars: 500 },
        card: (input) => ({ target: `${input.owner}/${input.repo}#${input.issueNumber}`, title: '', text: input.body }),
        tool: 'add_issue_comment',
        shape: null,
        args: (input) => ({ owner: input.owner, repo: input.repo, issue_number: input.issueNumber, body: input.body }),
    }),
];

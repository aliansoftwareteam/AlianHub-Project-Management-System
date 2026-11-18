// Where a passage's content came from, for the run taint contract (Modules/Agents/taint.js):
// 'member' for what a workspace member wrote or uploaded, 'agent' for what an agent wrote,
// 'external' for what arrived from outside the workspace. A row says it arrived from outside by
// carrying `origin: { kind, ref }`, which email-in and the public form stamp on the tasks they
// file; any kind counts, so an inbound path added later needs no change here.

const MEMBER = 'member';
const AGENT = 'agent';
const EXTERNAL = 'external';
const ORIGINS = [MEMBER, AGENT, EXTERNAL];
/* Where Modules/Forms/helpers/formUpload.js stores what an anonymous submitter sent. */
const FORM_UPLOAD_KEY = /^formAttachment\//;

const inbound = (row) => Boolean(row && row.origin && typeof row.origin === 'object' && row.origin.kind);

const written = (row, byAgent) => {
    if (inbound(row)) return EXTERNAL;
    return byAgent ? AGENT : MEMBER;
};

const ofTask = (task) => written(task, false);
const ofPage = (page) => written(page, Boolean(page && page.createdByAgent));
const ofComment = (comment) => written(comment, Boolean(comment && (comment.isAgent || comment.actorType === 'agent')));

/* An attachment record names its uploader, but the client writes that field and a form upload
 * carries the form owner's id, so it decides nothing. A file on a task that arrived from
 * outside reads as external whoever added it: marking too much only sends more to approval. */
const ofFile = ({ task, attachment } = {}) => (inbound(attachment) || inbound(task) || FORM_UPLOAD_KEY.test(String((attachment && attachment.url) || ''))
    ? EXTERNAL
    : MEMBER);

/* A chunk written before the field existed is not external: nothing inbound was indexed then. */
const ofChunk = (chunk) => {
    if (chunk && ORIGINS.includes(chunk.origin)) return chunk.origin;
    return chunk && chunk.authorKind === 'agent' ? AGENT : MEMBER;
};

module.exports = { MEMBER, AGENT, EXTERNAL, ORIGINS, inbound, ofTask, ofPage, ofComment, ofFile, ofChunk };

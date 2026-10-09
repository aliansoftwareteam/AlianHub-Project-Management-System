const idOf = (row = {}) => (row?._id ? String(row._id) : (row?.id ? String(row.id) : ""));

/* Where a comment heard over the socket goes in the list. A row is the same comment only by its id: the person's
 * connected AI writes under the person's own userId, so matching by author would hide what it wrote. A file the
 * person is uploading shows as a placeholder until its stored row comes back, matched by its file name. */
export function placeOfIncoming(rows, doc, { replaceSending = false } = {}) {
    const id = idOf(doc);
    const existing = id ? rows.findIndex((row) => idOf(row) === id) : -1;
    if (existing > -1) return { kind: "existing", index: existing };
    if (replaceSending && doc.mediaURL && doc.mediaURL.length) {
        const pending = rows.findIndex((row) => row.isSending && row.type === doc.type && row.mediaName === doc.mediaName);
        if (pending > -1) return { kind: "pending", index: pending };
    }
    return { kind: "new", index: -1 };
}

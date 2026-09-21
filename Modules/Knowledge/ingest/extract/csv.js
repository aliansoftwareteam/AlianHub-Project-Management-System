// Read by hand rather than by a spreadsheet library, which would sniff the text for other formats.

const rowsOf = (text, maxRows) => {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const endCell = () => { row.push(cell); cell = ''; };
    const endRow = () => { endCell(); rows.push(row); row = []; };
    for (let i = 0; i < text.length && rows.length <= maxRows; i += 1) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"' && !cell) quoted = true;
        else if (ch === ',') endCell();
        else if (ch === '\n') endRow();
        else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) endRow();
    return { rows: rows.slice(0, maxRows), partial: rows.length > maxRows };
};

const csvText = (text, maxRows) => {
    const { rows, partial } = rowsOf(text, maxRows);
    const lines = rows.map((row) => row.map((cell) => cell.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')).filter(Boolean);
    return { text: lines.join('\n'), partial };
};

module.exports = { csvText };

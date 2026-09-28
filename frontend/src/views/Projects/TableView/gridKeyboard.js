const CELL = '[role="cell"][data-col]';
const ROW = '[role="row"][data-row]';
const TYPING = 'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]';
const CONTROL = '[data-cell-edit], button:not([disabled]), input[type="checkbox"]:not([disabled]), a[href]';

const cellsOf = (row) => [...row.querySelectorAll(CELL)].filter((cell) => cell.closest(ROW) === row);

function neighbour(root, cell, key) {
    const row = cell.closest(ROW);
    const cells = cellsOf(row);
    const index = cells.indexOf(cell);
    if (key === 'ArrowLeft') return cells[index - 1] || null;
    if (key === 'ArrowRight') return cells[index + 1] || null;
    const rows = [...root.querySelectorAll(ROW)];
    const next = rows[rows.indexOf(row) + (key === 'ArrowUp' ? -1 : 1)];
    if (!next) return null;
    const column = cell.dataset.col;
    const target = cellsOf(next);
    return target.find((candidate) => candidate.dataset.col === column) || target[Math.min(index, target.length - 1)] || null;
}

/* Arrows move between cells, Enter opens the cell's editor and Esc leaves an editor for
   its cell. Keys typed into an editor, or into a picker opened over the grid, are its own. */
export function handleGridKey(event, root) {
    const target = event.target;
    if (!root || !(target instanceof Element) || !root.contains(target)) return false;
    const cell = target.closest(CELL);
    if (!cell) return false;
    const inEditor = target !== cell && Boolean(target.closest(TYPING));

    if (event.key === 'Escape') {
        if (target === cell) return false;
        Promise.resolve().then(() => { if (cell.isConnected) cell.focus(); });
        return true;
    }
    if (inEditor) return false;

    if (event.key === 'Enter' && target === cell) {
        const control = cell.querySelector(CONTROL);
        if (!control) return false;
        event.preventDefault();
        control.focus();
        control.click();
        return true;
    }

    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
    const next = neighbour(root, cell, event.key);
    if (!next) return false;
    event.preventDefault();
    next.focus();
    return true;
}

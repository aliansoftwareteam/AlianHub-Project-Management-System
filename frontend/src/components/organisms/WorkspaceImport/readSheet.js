const UTF8_CODEPAGE = 65001;

const isUtf8 = (buffer) => {
    try {
        new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        return true;
    } catch (_error) {
        return false;
    }
};

/* Every cell as text, the way the server's ClickUp rules expect it: epoch-millisecond dates must not become numbers.
 * A CSV names no encoding, and the library reads one without a byte order mark as Latin-1, which breaks every letter
 * outside ASCII; a file that is valid UTF-8 is read as UTF-8, and any other file as before. */
export async function readSheet(file) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", raw: true, ...(isUtf8(buffer) ? { codepage: UTF8_CODEPAGE } : {}) });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) : [];
}

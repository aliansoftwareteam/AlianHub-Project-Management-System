/* Every cell as text, the way the server's ClickUp rules expect it: epoch-millisecond dates must not become numbers. */
export async function readSheet(file) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return sheet ? XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) : [];
}

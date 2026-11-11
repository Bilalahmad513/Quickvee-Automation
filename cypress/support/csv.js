// Small helpers for reading exported report files.

// CSV text -> array of rows, each an array of cell strings. Handles quoted
// cells (which may hold commas, line breaks or "" for a quote). Blank lines
// are dropped.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// "$1,189.50", "-$0.00", "38.33%", "9 items", "490" -> a number; null if
// there's no number in it.
function toNumber(text) {
  const match = String(text).replace(/,/g, "").match(/-?\$?\d+(\.\d+)?/);
  return match ? Number(match[0].replace("$", "")) : null;
}

module.exports = { parseCsv, toNumber };

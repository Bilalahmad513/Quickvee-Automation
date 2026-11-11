// HTML report for the PO Products Report reconciliation (Test Case 01): each
// recorded check compares the same field across sources (UI / API / report)
// and is a Match only when every value is present and equal.
// resultText / formatCheckLine are reused by the spec for its live log lines.

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const resultText = (check) => (check && check.match ? "Match" : "Mismatch");

// e.g. "[Pricing · Cost] POS: 6.00 | Report: 6.00 → Match"
function formatCheckLine(check) {
  const values = (check.values || []).map((v) => `${v.label}: ${v.value}`).join(" | ");
  return `[${check.section} · ${check.field}] ${values} → ${resultText(check)}`;
}

function valueCells(values = []) {
  return values
    .map((v) => `<div class="val${v.differs ? " diff" : ""}"><span>${esc(v.label)}</span>${esc(v.value)}</div>`)
    .join("");
}

function checkRow(check) {
  return `<tr class="${check.match ? "pass" : "fail"}">
    <td>${esc(check.section)}</td>
    <td><b>${esc(check.field)}</b></td>
    <td>${valueCells(check.values)}</td>
    <td class="st">${check.match ? "✔ Match" : "✘ Mismatch"}</td>
  </tr>`;
}

function buildPoProductsHtml({ checks = [], info = {} }) {
  const matched = checks.filter((c) => c.match).length;
  const mismatched = checks.length - matched;
  const title = info.title || "PO Products Report — Reconciliation";
  const infoRows = Object.entries(info)
    .filter(([k, v]) => k !== "title" && v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? v.join(", ") : v)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f2937;background:#f9fafb;line-height:1.45}
 h1{margin:0 0 4px;font-size:22px}h2{margin:24px 0 10px;font-size:17px;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
 table{border-collapse:collapse;width:100%;background:#fff}
 th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top;font-size:13px}
 th{background:#f3f4f6}table.head{width:auto;margin-bottom:12px}
 td.st{white-space:nowrap;font-weight:700}
 tr.pass td.st{color:#166534}tr.fail{background:#fef2f2}tr.fail td.st{color:#991b1b}
 .val{margin:2px 0}.val>span{display:inline-block;min-width:90px;color:#6b7280;font-size:12px}
 .val.diff{color:#991b1b;font-weight:600}
 .pill{display:inline-block;padding:6px 12px;border-radius:6px;font-weight:600;margin:0 8px 10px 0}
 .pill.ok{background:#dcfce7;color:#166534}.pill.bad{background:#fee2e2;color:#991b1b}.pill.inf{background:#e0f2fe;color:#075985}
</style></head><body>
 <h1>${esc(title)}</h1>
 <table class="head">${infoRows}</table>
 <div class="pill ok">${matched} match</div>
 <div class="pill ${mismatched ? "bad" : "inf"}">${mismatched} mismatch</div>
 <h2>Checks (${checks.length})</h2>
 <table><thead><tr><th>Section</th><th>Field</th><th>Values</th><th>Result</th></tr></thead>
 <tbody>${checks.map(checkRow).join("") || '<tr><td colspan="4">No checks recorded.</td></tr>'}</tbody></table>
</body></html>`;
}

module.exports = { buildPoProductsHtml, formatCheckLine, resultText };

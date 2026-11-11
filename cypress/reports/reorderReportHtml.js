// HTML report for the Reorder Report check: the products that were reordered
// (reorder point / qty before -> after) and every value re-checked against the
// live report, marked MATCH / MISMATCH.

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function reorderedRows(reordered = []) {
  return reordered
    .map((p) => {
      const before = p.before || {};
      return `<tr>
        <td class="n">${esc(p.n)}</td>
        <td><b>${esc(p.title)}</b></td>
        <td>${esc(p.id)}</td>
        <td>${esc(before.point || 0)} &rarr; ${esc(p.point)}</td>
        <td>${esc(before.qty || 0)} &rarr; ${esc(p.qty)}</td>
      </tr>`;
    })
    .join("");
}

function resultRows(results = []) {
  return results
    .map(
      (r) => `<tr class="${r.match ? "pass" : "fail"}">
        <td><b>${esc(r.product)}</b></td>
        <td>${esc(r.check)}</td>
        <td>${esc(r.expected)}</td>
        <td>${esc(r.actual)}</td>
        <td class="st">${r.match ? "✔ MATCH" : "✘ MISMATCH"}</td>
      </tr>`
    )
    .join("");
}

function buildReorderReportHtml({ reordered = [], results = [], info = {}, title = "Reorder Report — QA" }) {
  const matched = results.filter((r) => r.match).length;
  const mismatched = results.length - matched;
  const infoRows = Object.entries(info)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f2937;background:#f9fafb;line-height:1.45}
 h1{margin:0 0 4px;font-size:22px}h2{margin:24px 0 10px;font-size:17px;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
 table{border-collapse:collapse;width:100%;background:#fff}
 th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top;font-size:13px}
 th{background:#f3f4f6}table.head{width:auto;margin-bottom:12px}
 td.n{width:40px;color:#6b7280}td.st{white-space:nowrap;font-weight:700}
 tr.pass td.st{color:#166534}tr.fail{background:#fef2f2}tr.fail td.st{color:#991b1b}
 .pill{display:inline-block;padding:6px 12px;border-radius:6px;font-weight:600;margin:0 8px 10px 0}
 .pill.ok{background:#dcfce7;color:#166534}.pill.bad{background:#fee2e2;color:#991b1b}.pill.inf{background:#e0f2fe;color:#075985}
 .err{background:#fef2f2;color:#991b1b;padding:8px 10px;border-radius:6px;white-space:pre-wrap;margin:8px 0}
</style></head><body>
 <h1>${esc(title)}</h1>
 <table class="head">${infoRows}</table>
 ${info.error ? `<div class="err">Step error: ${esc(info.error)}</div>` : ""}
 <div class="pill inf">${reordered.length} reordered</div>
 <div class="pill ok">${matched} matched</div>
 <div class="pill ${mismatched ? "bad" : "inf"}">${mismatched} mismatched</div>
 <h2>Products reordered (${reordered.length})</h2>
 <table><thead><tr><th>#</th><th>Product</th><th>Id</th><th>Reorder point</th><th>Reorder qty</th></tr></thead>
 <tbody>${reorderedRows(reordered) || '<tr><td colspan="5">None</td></tr>'}</tbody></table>
 <h2>Checks against the live report (${results.length})</h2>
 <table><thead><tr><th>Product</th><th>Check</th><th>Set value</th><th>Report value</th><th>Result</th></tr></thead>
 <tbody>${resultRows(results) || '<tr><td colspan="5">None</td></tr>'}</tbody></table>
</body></html>`;
}

module.exports = { buildReorderReportHtml };

// HTML pass/fail report for the Recorder Inventory deep analysis. Header +
// summary + a table (Test Case | What it checks | Expected | Actual | Status),
// then a bugs section with Steps to reproduce / Actual Result / Expected Result.

function esc(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const cls = (s) => ({ Pass: "pass", Fail: "fail", Info: "info", Skip: "skip" }[s] || "info");
const SEV = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function stepsHtml(steps) {
  if (!steps) return "";
  const list = Array.isArray(steps) ? steps : String(steps).split("\n").filter(Boolean);
  return `<ol>${list.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
}

function buildRecorderInventoryHtml({ header = {}, cases = [], bugs = [], title = "Recorder Inventory — QA Deep Analysis" }) {
  const counts = cases.reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {});
  const headRows = Object.entries(header).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
  const caseRows = cases
    .map(
      (c, i) => `<tr class="${cls(c.status)}"><td class="n">${i + 1}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.checks)}</td><td>${esc(c.expected)}</td><td>${esc(c.actual)}</td><td class="st">${esc(c.status)}</td></tr>`
    )
    .join("");
  const sortedBugs = [...bugs].sort((a, b) => (SEV[a.severity] ?? 9) - (SEV[b.severity] ?? 9));
  const bugHtml = sortedBugs
    .map(
      (b, i) => `<div class="bug"><div class="bh"><span class="sev sev-${esc(b.severity)}">${esc(b.severity)}</span><b>${i + 1}. ${esc(b.title)}</b></div>
      <div class="f"><span>Steps to reproduce</span>${stepsHtml(b.steps)}</div>
      <div class="f"><span>Actual Result</span><div class="v bad">${esc(b.actual)}</div></div>
      <div class="f"><span>Expected Result</span><div class="v good">${esc(b.expected)}</div></div></div>`
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#1f2937;background:#f9fafb;line-height:1.45}
 h1{margin:0 0 4px;font-size:22px}h2{margin:24px 0 10px;font-size:17px;border-bottom:2px solid #e5e7eb;padding-bottom:4px}
 table{border-collapse:collapse;width:100%;background:#fff}
 th,td{border:1px solid #e5e7eb;padding:8px 10px;text-align:left;vertical-align:top;font-size:13px}
 th{background:#f3f4f6}
 table.head{width:auto;margin-bottom:12px}
 td.n{width:30px;color:#6b7280}td.st{white-space:nowrap;font-weight:700}
 .pill{display:inline-block;padding:6px 12px;border-radius:6px;font-weight:600;margin:0 8px 10px 0}
 .pill.ok{background:#dcfce7;color:#166534}.pill.bad{background:#fee2e2;color:#991b1b}.pill.inf{background:#e0f2fe;color:#075985}.pill.sk{background:#f3f4f6;color:#374151}
 tr.pass td.st{color:#166534}tr.fail{background:#fef2f2}tr.fail td.st{color:#991b1b}tr.info td.st{color:#075985}tr.skip td.st{color:#6b7280}
 .bug{background:#fff;border:1px solid #e5e7eb;border-left:5px solid #b91c1c;border-radius:8px;padding:12px 14px;margin:10px 0}
 .bh{display:flex;align-items:center;gap:8px}
 .f{margin-top:8px}.f>span{display:block;font-size:12px;text-transform:uppercase;color:#6b7280;margin-bottom:2px}
 .v{padding:6px 10px;border-radius:6px;background:#f3f4f6;white-space:pre-wrap}.v.bad{background:#fef2f2;color:#991b1b}.v.good{background:#ecfdf5;color:#065f46}
 .sev{color:#fff;font-size:11px;padding:2px 7px;border-radius:4px}.sev-Critical{background:#7f1d1d}.sev-High{background:#b91c1c}.sev-Medium{background:#d97706}.sev-Low{background:#6b7280}
 ol{margin:2px 0 0 18px}
</style></head><body>
 <h1>${esc(title)}</h1>
 <table class="head">${headRows}</table>
 <div class="pill ok">${counts.Pass || 0} passed</div>
 <div class="pill ${counts.Fail ? "bad" : "inf"}">${counts.Fail || 0} failed</div>
 <div class="pill inf">${counts.Info || 0} info</div>
 <div class="pill sk">${counts.Skip || 0} skipped / cannot verify</div>
 <div class="pill ${bugs.length ? "bad" : "ok"}">${bugs.length} bug${bugs.length === 1 ? "" : "s"}</div>
 <h2>Test cases (${cases.length})</h2>
 <table><thead><tr><th>#</th><th>Test Case</th><th>What it checks</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>
 <tbody>${caseRows}</tbody></table>
 <h2>Bugs / issues (${bugs.length})</h2>
 ${sortedBugs.length ? bugHtml : "<p>No failing checks recorded.</p>"}
</body></html>`;
}

module.exports = { buildRecorderInventoryHtml };

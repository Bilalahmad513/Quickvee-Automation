// HTML report for "QA Testing - Reorder Report - New": every check run on
// the report, grouped by area and marked Pass / Fail / Info, with the bugs
// found listed first (by severity) and the failing rows of each check.

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const statusClass = (s) => ({ Pass: "pass", Fail: "fail", Info: "info" }[s] || "info");
const statusText = (s) => ({ Pass: "✔ Pass", Fail: "✘ Fail", Info: "ⓘ Info" }[s] || s);

// e.g. "[Last 30 Days] Formula · Gross profit = Net sale − COGS → expected 485 | actual 485 ✔ Pass"
function formatCheckLine(c) {
  return `[${c.area}] ${c.name} → expected: ${formatValue(c.expected)} | actual: ${formatValue(c.actual)} ${statusText(c.status)}${c.status === "Fail" && c.severity ? ` (${c.severity})` : ""}`;
}

function examplesTable(examples) {
  if (!examples || !examples.length) return "";
  const cols = Cypress._.uniq(examples.flatMap((e) => Object.keys(e)));
  return `<details><summary>${examples.length} example row${examples.length > 1 ? "s" : ""}</summary>
    <table class="ex"><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
    <tbody>${examples.map((e) => `<tr>${cols.map((c) => `<td>${escapeHtml(formatValue(e[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}

function checkRows(checks) {
  return checks
    .map(
      (c) => `
      <tr class="${statusClass(c.status)}">
        <td>${escapeHtml(c.area)}</td>
        <td><b>${escapeHtml(c.name)}</b>${c.how ? `<div class="note">${escapeHtml(c.how)}</div>` : ""}</td>
        <td>${escapeHtml(formatValue(c.expected))}</td>
        <td>${escapeHtml(formatValue(c.actual))}</td>
        <td class="result">${escapeHtml(statusText(c.status))}${c.status === "Fail" && c.severity ? `<div class="sev sev-${escapeHtml(c.severity)}">${escapeHtml(c.severity)}</div>` : ""}</td>
        <td>${c.details ? `<div>${escapeHtml(c.details)}</div>` : ""}${examplesTable(c.examples)}</td>
      </tr>`
    )
    .join("");
}

const checkTable = (checks) => `
  <table>
    <thead><tr><th>Area</th><th>Check</th><th>Expected</th><th>Actual</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>${checkRows(checks)}</tbody>
  </table>`;

function buildQaReorderHtml({ info, checks, title = "QA Testing - Reorder Report - New", extraHtml = "" }) {
  const counts = Cypress._.countBy(checks, "status");
  const bugs = Cypress._.sortBy(
    checks.filter((c) => c.status === "Fail"),
    (c) => SEVERITY_ORDER[c.severity] ?? 9
  );
  const areas = Cypress._.uniq(checks.map((c) => c.area));
  const infoRows = Object.entries(info)
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(formatValue(v))}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2937; background: #f9fafb; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { margin: 28px 0 10px; font-size: 18px; }
  .meta { color: #6b7280; margin-bottom: 16px; }
  .summary { display: inline-block; padding: 6px 12px; border-radius: 6px; font-weight: 600; margin: 0 8px 8px 0; }
  .summary.ok { background: #dcfce7; color: #166534; }
  .summary.bad { background: #fee2e2; color: #991b1b; }
  .summary.inf { background: #e0f2fe; color: #075985; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em; }
  table.info { width: auto; margin-bottom: 16px; }
  table.info th { text-transform: none; letter-spacing: 0; }
  table.ex { font-size: 12px; margin-top: 6px; }
  table.ex th { text-transform: none; font-size: 12px; }
  .note { font-size: 12px; color: #6b7280; margin-top: 4px; }
  tr.pass .result { color: #166534; font-weight: 600; }
  tr.fail { background: #fef2f2; }
  tr.fail .result { color: #991b1b; font-weight: 600; }
  tr.info .result { color: #075985; font-weight: 600; }
  .sev { display: inline-block; margin-top: 4px; font-size: 11px; padding: 1px 6px; border-radius: 4px; color: #fff; }
  .sev-Critical { background: #7f1d1d; } .sev-High { background: #b91c1c; } .sev-Medium { background: #d97706; } .sev-Low { background: #6b7280; }
  details summary { cursor: pointer; color: #1d4ed8; font-size: 12px; margin-top: 4px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)} - ${escapeHtml(info.Store)}</h1>
  <div class="meta">Generated ${escapeHtml(info.Generated)}</div>
  <table class="info">${infoRows}</table>
  <div class="summary ${counts.Fail ? "bad" : "ok"}">${checks.length} checks: ${counts.Pass || 0} pass, ${counts.Fail || 0} fail</div>
  <div class="summary inf">${counts.Info || 0} info (observations)</div>

  <h2>Bugs found (${bugs.length}) - by severity</h2>
  ${bugs.length ? checkTable(bugs) : "<p>No failing check.</p>"}
  ${extraHtml}

  ${areas.map((area) => `<h2>${escapeHtml(area)}</h2>${checkTable(checks.filter((c) => c.area === area))}`).join("\n")}
</body>
</html>
`;
}

module.exports = { buildQaReorderHtml, formatCheckLine, statusText };

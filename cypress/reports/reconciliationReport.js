// "money" -> $1,065.11, "count" -> 8, "percent" -> 4.04%
function formatAmount(amount, raw, format) {
  if (amount === null) return `missing (${JSON.stringify(raw)})`;
  if (format === "count") return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (format === "percent") return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  return "$" + amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function rangeTitle(range) {
  return range.label.charAt(0).toUpperCase() + range.label.slice(1);
}

function rangeDates(range) {
  return range.startDate === range.endDate ? range.startDate : `${range.startDate} to ${range.endDate}`;
}

function formatValue(value, format, bold = false) {
  const amount = formatAmount(value.amount, value.raw, format);
  const separator = value.separator || ": ";
  return `${value.label}${separator}${bold ? `**${amount}**` : amount}${value.differs ? " ⚠" : ""}`;
}

// The values a row shows, in order. A group row (reportMappings.js) already
// has them; a formula row (formulaChecks.js) shows the formula with its
// inputs and result, then the value the report itself shows - flagged when
// it's wrong, since that's the value under test.
function rowValues(row) {
  if (row.kind !== "formula") return row.values;
  const inputs = Cypress._.fromPairs(
    row.inputs.map((i) => [i.name, `${i.label} ${formatAmount(i.amount, i.raw, i.format)}`])
  );
  return [
    { label: row.display(inputs), separator: " = ", amount: row.expected, raw: null },
    { label: row.actual.label, amount: row.actual.amount, raw: row.actual.raw, differs: !row.match },
  ];
}

// e.g. "Today (2026-10-23) · Net Sales → Dashboard Total Sales Revenue: $303.00 | Sales Summary Net Sales: $303.00 | ... ✔ MATCH"
// On a mismatch, the values that differ from the rest are marked with ⚠.
// "✔ MATCH", "✔ MATCH (within ±$0.05)" for a match only within a mapping's
// tolerance, or "✘ MISMATCH".
function resultText(row) {
  if (!row.match) return "✘ MISMATCH";
  return row.withinTolerance ? `✔ MATCH (within ±$${row.tolerance.toFixed(2)})` : "✔ MATCH";
}

function formatLine(row) {
  return (
    `${rangeTitle(row.range)} (${rangeDates(row.range)}) · ${row.label} → ` +
    rowValues(row).map((v) => formatValue(v, row.format)).join(" | ") +
    " " + resultText(row)
  );
}

// Cypress gives every command-log entry a `command-name-<name>` class, so
// logging under a custom name ("match"/"mismatch") lets plain CSS colour
// those rows. The command log lives in the runner's own document (the spec
// runs in an iframe), hence window.top. Colours are translucent so they read
// on the runner's dark theme.
const LOG_STYLES = `
  .command-name-match .command-wrapper { background: rgba(46, 160, 67, 0.25) !important; border-left: 4px solid #2ea043 !important; }
  .command-name-match .command-method, .command-name-match .command-message { color: #7ee787 !important; }
  .command-name-mismatch .command-wrapper { background: rgba(248, 81, 73, 0.25) !important; border-left: 4px solid #f85149 !important; }
  .command-name-mismatch .command-method, .command-name-mismatch .command-message { color: #ff7b72 !important; }
`;

function injectLogStyles() {
  const doc = window.top.document;
  if (doc.getElementById("reconciliation-log-styles")) return;
  const style = doc.createElement("style");
  style.id = "reconciliation-log-styles";
  style.textContent = LOG_STYLES;
  doc.head.appendChild(style);
}

function logRow(row) {
  Cypress.log({
    name: row.match ? "match" : "mismatch",
    displayName: resultText(row),
    message:
      `[${row.store}] **${rangeTitle(row.range)}** (${rangeDates(row.range)}) · **${row.label}** → ` +
      rowValues(row).map((v) => formatValue(v, row.format, true)).join(" | "),
    consoleProps: () => ({ store: row.store, range: row.range, check: row.label, values: rowValues(row) }),
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(rows, generatedAt, title = "Report Reconciliation") {
  const mismatches = rows.filter((r) => !r.match).length;
  const tableRows = rows
    .map(
      (r) => `
      <tr class="${r.match ? "match" : "mismatch"}">
        <td>${escapeHtml(r.store)}</td>
        <td>${escapeHtml(rangeTitle(r.range))}</td>
        <td>${escapeHtml(rangeDates(r.range))}</td>
        <td>${escapeHtml(r.label)}</td>
        <td><div class="values">${rowValues(r)
          .map(
            (v) =>
              `<div class="value${v.differs ? " differs" : ""}"><span class="label">${escapeHtml(v.label)}</span><b>${escapeHtml(
                formatAmount(v.amount, v.raw, r.format)
              )}</b></div>`
          )
          .join("")}</div></td>
        <td class="result">${escapeHtml(resultText(r))}</td>
      </tr>`
    )
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
  .meta { color: #6b7280; margin-bottom: 16px; }
  .summary { display: inline-block; padding: 6px 12px; border-radius: 6px; font-weight: 600; margin-bottom: 16px; }
  .summary.ok { background: #dcfce7; color: #166534; }
  .summary.bad { background: #fee2e2; color: #991b1b; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em; }
  .label { display: block; font-size: 12px; color: #6b7280; margin-bottom: 2px; }
  .values { display: flex; flex-wrap: wrap; gap: 8px; }
  .value { min-width: 170px; padding: 6px 10px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; }
  .value.differs { border-color: #f87171; background: #fee2e2; color: #991b1b; }
  tr.match .result { color: #166534; font-weight: 600; }
  tr.mismatch { background: #fef2f2; }
  tr.mismatch .result { color: #991b1b; font-weight: 600; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Generated ${escapeHtml(generatedAt)}</div>
  <div class="summary ${mismatches ? "bad" : "ok"}">
    ${rows.length} comparisons, ${rows.length - mismatches} matched, ${mismatches} mismatched
  </div>
  <table>
    <thead>
      <tr><th>Store</th><th>Date filter</th><th>Date range</th><th>Check</th><th>Values</th><th>Result</th></tr>
    </thead>
    <tbody>${tableRows}
    </tbody>
  </table>
</body>
</html>
`;
}

module.exports = { formatLine, buildHtml, injectLogStyles, logRow };

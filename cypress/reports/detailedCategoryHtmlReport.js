// Detailed HTML report for the Category Sales (Detailed) Export CSV check:
// run summary, Grand Total cards, a category index, then per category every
// item row with each column's report value next to its Export CSV value, and
// the raw CSV at the end. `detail` is compareDetailedCategoryCsv()'s.

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const shown = (value) => (value === undefined || value === null || value === "" ? "—" : value);

// One compared value: report on top, CSV below; red when they differ.
function cellHtml(cell) {
  return `<td class="cell ${cell.match ? "ok" : "bad"}">
      <div class="r" title="Report">${escapeHtml(shown(cell.report))}</div>
      <div class="c" title="Export CSV">${escapeHtml(shown(cell.csv))}</div>
    </td>`;
}

function nameHtml(reportName, csvName, match) {
  const csv = csvName === undefined ? "(not in CSV)" : csvName;
  return `<td class="name ${match ? "ok" : "bad"}">
      <div class="r">${escapeHtml(shown(reportName))}</div>
      ${match ? "" : `<div class="c">CSV: ${escapeHtml(csv)}</div>`}
    </td>`;
}

const badge = (match) => `<span class="badge ${match ? "ok" : "bad"}">${match ? "✔ MATCH" : "✘ MISMATCH"}</span>`;

function categorySection(category, index, valueColumns) {
  const head = `<tr><th>Item Name</th>${valueColumns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}<th>Result</th></tr>`;
  const items = category.items
    .map(
      (item) => `<tr class="${item.match ? "" : "row-bad"}">${nameHtml(item.name, item.csvName, item.nameMatch)}${item.cells
        .map(cellHtml)
        .join("")}<td>${badge(item.match)}</td></tr>`
    )
    .join("");
  const extras = category.extraCsvItems
    .map((name) => `<tr class="row-bad"><td class="name bad" colspan="${valueColumns.length + 1}">Only in CSV: ${escapeHtml(name)}</td><td>${badge(false)}</td></tr>`)
    .join("");
  const total = `<tr class="total ${category.total.match ? "" : "row-bad"}"><td class="name"><b>Total</b>${
    category.total.inCsv ? "" : ' <span class="c">(no Total row in CSV)</span>'
  }</td>${category.total.cells.map(cellHtml).join("")}<td>${badge(category.total.match)}</td></tr>`;

  return `
  <details id="cat-${index}" ${category.match ? "" : "open"}>
    <summary>${badge(category.match)} <b>${escapeHtml(category.name)}</b>
      <span class="muted">· ${category.items.length} items${
        category.nameMatch ? "" : ` · CSV category name: "${escapeHtml(shown(category.csvName))}"`
      }</span></summary>
    <div class="scroll"><table class="grid"><thead>${head}</thead><tbody>${items}${extras}${total}</tbody></table></div>
  </details>`;
}

function buildDetailedCategoryHtml({ detail, rows, info }) {
  const valueColumns = detail.columns.filter((c) => c !== "Item Name");
  const allCells = [
    ...detail.categories.flatMap((c) => [...c.items.flatMap((i) => i.cells), ...c.total.cells]),
    ...detail.grandTotal.cells,
  ];
  const cellMismatches = allCells.filter((c) => !c.match).length;
  const failedChecks = rows.filter((r) => !r.match);
  const passed = failedChecks.length === 0;
  const itemCount = detail.categories.reduce((sum, c) => sum + c.items.length, 0);

  const grandCards = detail.grandTotal.cells
    .map(
      (c) => `<div class="card ${c.match ? "ok" : "bad"}"><div class="muted">${escapeHtml(c.column)}</div>
        <div><span class="muted">Report</span> <b>${escapeHtml(shown(c.report))}</b></div>
        <div><span class="muted">CSV</span> <b>${escapeHtml(shown(c.csv))}</b></div></div>`
    )
    .join("");

  const netIndex = detail.columns.indexOf("Net Sales");
  const index = detail.categories
    .map((c, i) => {
      const net = c.total.cells.find((cell) => cell.column === "Net Sales");
      return `<tr class="${c.match ? "" : "row-bad"}"><td><a href="#cat-${i}">${escapeHtml(c.name)}</a></td><td>${c.items.length}</td><td>${
        c.items.filter((r) => r.csvName !== undefined).length + c.extraCsvItems.length
      }</td><td>${netIndex >= 0 && net ? escapeHtml(net.report) : "—"}</td><td>${badge(c.match)}</td></tr>`;
    })
    .join("");

  const problems = failedChecks.length
    ? `<h2>Mismatches (${failedChecks.length})</h2><ul class="problems">${failedChecks
        .map((r) => `<li>${escapeHtml(r.line)}</li>`)
        .join("")}</ul>`
    : "";

  const extraCategories = detail.extraCsvCategories.length
    ? `<p class="bad-text">Categories only in the CSV: ${detail.extraCsvCategories.map(escapeHtml).join(", ")}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Category Sales (Detailed) — Export CSV vs Report</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; margin: 24px; color: #1f2937; background: #f9fafb; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { font-size: 17px; margin: 28px 0 10px; }
  .muted { color: #6b7280; font-size: 12px; }
  .status { display: inline-block; padding: 8px 14px; border-radius: 6px; font-weight: 700; font-size: 16px; margin: 12px 0; }
  .status.ok { background: #dcfce7; color: #166534; } .status.bad { background: #fee2e2; color: #991b1b; }
  table.info { border-collapse: collapse; background: #fff; }
  table.info td { border: 1px solid #e5e7eb; padding: 6px 12px; }
  table.info td:first-child { color: #6b7280; width: 220px; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-left-width: 4px; border-radius: 6px; padding: 8px 12px; min-width: 150px; }
  .card.ok { border-left-color: #22c55e; } .card.bad { border-left-color: #ef4444; background: #fef2f2; }
  table.grid, table.index { border-collapse: collapse; width: 100%; background: #fff; font-size: 13px; }
  .grid th, .grid td, .index th, .index td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
  .grid th, .index th { background: #253338; color: #fff; font-weight: 600; white-space: nowrap; }
  .cell .r { font-weight: 600; } .cell .c, .name .c { color: #6b7280; font-size: 12px; }
  .cell.ok .c::before { content: "CSV "; } .cell.bad .c::before { content: "CSV "; }
  td.bad { background: #fee2e2; } td.bad .c { color: #991b1b; font-weight: 600; }
  tr.total td { background: #f3f4f6; } tr.total td.bad { background: #fee2e2; }
  tr.row-bad td:last-child { background: #fee2e2; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
  .badge.ok { background: #dcfce7; color: #166534; } .badge.bad { background: #fee2e2; color: #991b1b; }
  details { background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 10px; }
  summary { cursor: pointer; padding: 10px 12px; }
  .scroll { overflow-x: auto; padding: 0 12px 12px; }
  .problems li { color: #991b1b; margin-bottom: 4px; font-family: Consolas, monospace; font-size: 12px; }
  .bad-text { color: #991b1b; font-weight: 600; }
  pre { background: #111827; color: #e5e7eb; padding: 12px; border-radius: 6px; overflow: auto; max-height: 500px; font-size: 12px; }
</style>
</head>
<body>
  <h1>Category Sales (Detailed) — Export CSV vs Report</h1>
  <div class="muted">Generated ${escapeHtml(info.generatedAt)} · read-only check (no data created, edited or deleted)</div>
  <div class="status ${passed ? "ok" : "bad"}">${passed ? "✔ PASSED — Export CSV matches the report" : `✘ FAILED — ${failedChecks.length} mismatch(es)`}</div>

  <table class="info">
    <tr><td>Store</td><td>${escapeHtml(info.storeName)} (${escapeHtml(info.storeId)})</td></tr>
    <tr><td>Report</td><td>Reporting › Sales › Category Sales (Detailed)</td></tr>
    <tr><td>Date filter</td><td>Last 30 Days (${escapeHtml(info.range.startDate)} to ${escapeHtml(info.range.endDate)})</td></tr>
    <tr><td>Downloaded file</td><td>${escapeHtml(info.fileName)}</td></tr>
    <tr><td>Categories (report / CSV)</td><td>${detail.categories.length} / ${detail.csvCategoryCount}</td></tr>
    <tr><td>Item rows in report</td><td>${itemCount}</td></tr>
    <tr><td>Values compared</td><td>${allCells.length} (${allCells.length - cellMismatches} matched, ${cellMismatches} mismatched)</td></tr>
    <tr><td>CSV columns</td><td>${escapeHtml(detail.csvHeader.join(", "))}${
      detail.missingColumns.length ? ` <span class="bad-text">· missing: ${escapeHtml(detail.missingColumns.join(", "))}</span>` : ""
    }</td></tr>
  </table>

  ${problems}

  <h2>Grand Total</h2>
  <div class="cards">${grandCards}</div>

  <h2>Categories</h2>
  <table class="index"><thead><tr><th>Category</th><th>Items (report)</th><th>Items (CSV)</th><th>Net Sales</th><th>Result</th></tr></thead><tbody>${index}</tbody></table>
  ${extraCategories}

  <h2>Category details</h2>
  <div class="muted" style="margin-bottom:8px">Each cell: report value (bold), Export CSV value below. Red = different.</div>
  ${detail.categories.map((c, i) => categorySection(c, i, valueColumns)).join("")}

  <h2>Downloaded CSV (raw)</h2>
  <details><summary>${escapeHtml(info.fileName)}</summary><pre>${escapeHtml(info.csvText)}</pre></details>
</body>
</html>
`;
}

module.exports = { buildDetailedCategoryHtml };

// Compares the Category Sold Report's Export CSV with the report's own data
// (category_sales_report_api_fact): every category row, column by column,
// and the CSV's column sums with the report's totals. Returns rows in the
// same shape as ReportsApi.reconcile(), for the same log/HTML report.

// CSV header -> the API's per-category field, its total field, and format.
// Margin is a percentage, so its total isn't a sum - only compared per row.
const COLUMNS = [
  { csv: "Qty", field: "total_qty", total: "total_qty", format: "count" },
  { csv: "Subtotal", field: "subtotal", total: "total_subtotal", format: "money" },
  { csv: "Price Override", field: "price_override", total: "total_price_override", format: "money" },
  { csv: "Discounts", field: "discounts", total: "total_discounts", format: "money" },
  { csv: "Subtotal w/ Discounts", field: "subtotal_with_discounts", total: "total_subtotal_with_discounts", format: "money" },
  { csv: "Total", field: "total_amount", total: "total_amount", format: "money" },
  { csv: "Cost", field: "cost", total: "total_cost", format: "money" },
  { csv: "Profit", field: "profit", total: "total_profit", format: "money" },
  { csv: "Margin", field: "margin", format: "percent" },
];

function toAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100 + 0;
}

// Handles quoted fields ("A, B" and "" escapes), since category names can
// contain commas.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);

  const [header = [], ...data] = rows;
  return { header, records: data.map((r) => Cypress._.zipObject(header, r)) };
}

// A range with no sales: the API answers status false / no rows, and the
// CSV is just its header (or empty).
function apiRows(body) {
  return (body && body.category_sale_data) || [];
}

function groupRow(range, label, format, values) {
  const amounts = values.map((v) => v.amount);
  const match = amounts.every((a) => a !== null) && new Set(amounts).size === 1;
  if (!match) values.forEach((v, i) => (v.differs = i > 0 && v.amount !== values[0].amount));
  return { kind: "group", range, label, format, values, match };
}

function compareCategorySoldCsv(csvText, apiBody, range) {
  const { header, records } = parseCsv(csvText);
  const rows = [];

  const missingColumns = COLUMNS.filter((c) => !header.includes(c.csv)).map((c) => c.csv);
  rows.push({
    ...groupRow(range, "Export CSV columns", "count", [
      { label: "Expected columns", amount: COLUMNS.length, raw: COLUMNS.length },
      { label: "Found in CSV", amount: COLUMNS.length - missingColumns.length, raw: header.join(", ") },
    ]),
  });

  const api = apiRows(apiBody);
  const csvByName = Cypress._.groupBy(records, "Category");
  const apiByName = Cypress._.groupBy(api, "category_name");
  const names = Cypress._.uniq([...Object.keys(apiByName), ...Object.keys(csvByName)]);

  // One row per category/column that differs (or exists on one side only),
  // so a mismatch says exactly where.
  const differences = [];
  names.forEach((name) => {
    const csvRow = (csvByName[name] || [])[0];
    const apiRow = (apiByName[name] || [])[0];
    const duplicated = (csvByName[name] || []).length > 1 || (apiByName[name] || []).length > 1;
    COLUMNS.forEach((col) => {
      const csvValue = csvRow ? toAmount(csvRow[col.csv]) : null;
      const apiValue = apiRow ? toAmount(apiRow[col.field]) : null;
      if (duplicated || csvValue === null || csvValue !== apiValue) {
        differences.push(
          groupRow(range, `Category "${name}" · ${col.csv}${duplicated ? " (name listed twice)" : ""}`, col.format, [
            { label: `Export CSV ${col.csv}`, amount: csvValue, raw: csvRow ? csvRow[col.csv] : undefined },
            { label: `Category Sold ${col.csv}`, amount: apiValue, raw: apiRow ? apiRow[col.field] : undefined },
          ])
        );
        differences[differences.length - 1].match = false;
      }
    });
  });

  const matchingCategories = names.length - Cypress._.uniq(differences.map((d) => d.label.split(" · ")[0])).length;
  rows.push(
    groupRow(range, "Export CSV categories (every column equal)", "count", [
      { label: "Export CSV categories", amount: records.length, raw: records.length },
      { label: "Category Sold categories", amount: api.length, raw: api.length },
      { label: "Categories matching on every column", amount: matchingCategories, raw: matchingCategories },
    ])
  );

  // Column sums of the CSV vs the report's own totals (what the page's
  // summary cards show).
  COLUMNS.filter((c) => c.total).forEach((col) => {
    const sum = toAmount(records.reduce((acc, r) => acc + (Number(r[col.csv]) || 0), 0));
    const total = api.length ? toAmount(apiBody[col.total]) : 0;
    rows.push(
      groupRow(range, `Export CSV ${col.csv} total`, col.format, [
        { label: `Export CSV ${col.csv} (sum of rows)`, amount: sum, raw: sum },
        { label: `Category Sold ${col.csv} total`, amount: total, raw: apiBody && apiBody[col.total] },
      ])
    );
  });

  return [...rows, ...differences];
}

// The downloaded file and the export API's answer, with line endings and a
// UTF-8 BOM ignored.
function normalizeCsv(text) {
  return String(text || "").replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();
}

module.exports = { compareCategorySoldCsv, normalizeCsv, parseCsv };

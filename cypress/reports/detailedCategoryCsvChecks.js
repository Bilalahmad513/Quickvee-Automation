// Compares the Category Sales (Detailed) report's downloaded Export CSV with
// the report table the page shows: every category, every item row column by
// column, each category's "Total" row and the "Grand Total" row.
//
// The CSV (react-csv, built in the browser) lists a category's name on its
// first item row only, then a "Total" row per category, then one
// "Grand Total" row. Its column labels are the table's own header labels
// plus a leading "Category".
//
// Returns { detail, rows }: `detail` is every cell compared, for the HTML
// report (detailedCategoryHtmlReport.js); `rows` are summary/mismatch rows in
// the same shape as ReportsApi.reconcile(), for the command log.
const { parseCsv } = require("./categorySoldCsvChecks");

const NAME_COLUMN = "Item Name";

// "$1,234.50", "-$5.00" (formatCurrency), "$-5.00" (Net Sales cells) and
// "3" all read as plain numbers, rounded to cents.
function toAmount(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isNaN(n) ? null : Math.round(n * 100) / 100 + 0;
}

// The CSV drops double quotes from item names; whitespace can differ too.
const normalizeName = (name) => String(name || "").replace(/"/g, "").replace(/\s+/g, " ").trim();

const formatOf = (column) => (column === "Quantity" ? "count" : "money");

// CSV records -> [{ name, items: [record], total: record }] and the
// Grand Total record.
function groupCsv(records) {
  const categories = [];
  let current = null;
  let grandTotal = null;
  records.forEach((record) => {
    const category = (record.Category || "").trim();
    if (category === "Grand Total") {
      grandTotal = record;
    } else if (category === "Total") {
      if (current) current.total = record;
      current = null;
    } else {
      if (category || !current) {
        current = { name: category, items: [], total: null };
        categories.push(current);
      }
      current.items.push(record);
    }
  });
  return { categories, grandTotal };
}

// Every numeric column of one table row against its CSV record (null when
// the CSV has no such row).
function compareCells(columns, cells, record) {
  return columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => column !== NAME_COLUMN)
    .map(({ column, index }) => {
      const report = cells ? cells[index] : undefined;
      const csv = record ? record[column] : undefined;
      const reportAmount = toAmount(report);
      const csvAmount = toAmount(csv);
      return { column, format: formatOf(column), report, csv, reportAmount, csvAmount, match: reportAmount !== null && reportAmount === csvAmount };
    });
}

function compareRow(columns, cells, record, nameIndex) {
  const name = cells && nameIndex >= 0 ? cells[nameIndex] : undefined;
  const csvName = record ? record[NAME_COLUMN] : undefined;
  const nameMatch = record !== undefined && cells !== undefined && normalizeName(name) === normalizeName(csvName);
  const cellResults = compareCells(columns, cells, record);
  return { name, csvName, nameMatch, cells: cellResults, match: nameMatch && cellResults.every((c) => c.match) };
}

function buildDetail(csvText, table) {
  const { header, records } = parseCsv(csvText);
  const csv = groupCsv(records);
  const columns = table.categories.length ? table.categories[0].headers : [];
  const nameIndex = columns.indexOf(NAME_COLUMN);

  const categories = table.categories.map((category, i) => {
    const csvCategory = csv.categories[i];
    const items = category.items.map((cells, j) => compareRow(category.headers, cells, csvCategory && csvCategory.items[j], nameIndex));
    const extraCsvItems = csvCategory ? csvCategory.items.slice(category.items.length).map((r) => r[NAME_COLUMN]) : [];
    const totalCells = compareCells(category.headers, category.total, csvCategory && csvCategory.total);
    const nameMatch = !!csvCategory && normalizeName(csvCategory.name) === normalizeName(category.name);
    return {
      name: category.name,
      csvName: csvCategory ? csvCategory.name : undefined,
      nameMatch,
      items,
      extraCsvItems,
      total: { cells: totalCells, inCsv: !!(csvCategory && csvCategory.total), match: totalCells.every((c) => c.match) },
      match: nameMatch && items.every((r) => r.match) && !extraCsvItems.length && totalCells.every((c) => c.match),
    };
  });

  const grandTotalCells = compareCells(columns, table.grandTotal, csv.grandTotal);
  return {
    columns,
    csvHeader: header,
    csvCategoryCount: csv.categories.length,
    missingColumns: columns.filter((c) => !header.includes(c)),
    categories,
    extraCsvCategories: csv.categories.slice(table.categories.length).map((c) => c.name),
    grandTotal: { cells: grandTotalCells, inCsv: !!csv.grandTotal, match: grandTotalCells.every((c) => c.match) },
  };
}

function valueRow(range, label, format, report, csv) {
  const values = [
    { label: "Report", amount: toAmount(report), raw: report },
    { label: "Export CSV", amount: toAmount(csv), raw: csv },
  ];
  const match = values[0].amount !== null && values[0].amount === values[1].amount;
  if (!match) values[1].differs = true;
  return { kind: "group", range, label, format, values, match };
}

// A mismatch in text (a name) - says both sides in the label itself.
function textMismatch(range, label, reportText, csvText) {
  return { kind: "group", range, label: `${label}: report "${reportText}", Export CSV "${csvText}"`, values: [], match: false };
}

const cellRows = (range, where, cells) =>
  cells.filter((c) => !c.match).map((c) => valueRow(range, `${where} · ${c.column}`, c.format, c.report, c.csv));

// Summary rows (one per category, Grand Total per column) plus one row per
// difference, for the command log.
function summaryRows(detail, range) {
  const rows = [];
  rows.push(
    valueRow(range, `Export CSV columns (missing: ${detail.missingColumns.join(", ") || "none"})`, "count", detail.columns.length + 1, detail.csvHeader.length)
  );
  rows.push(valueRow(range, "Categories", "count", detail.categories.length, detail.csvCategoryCount));

  detail.categories.forEach((category, i) => {
    const where = `Category "${category.name}"`;
    const csvItemCount = category.items.filter((r) => r.csvName !== undefined).length + category.extraCsvItems.length;
    const summary = valueRow(range, `${where} items (every column equal)`, "count", category.items.length, category.csvName === undefined ? null : csvItemCount);
    summary.match = summary.match && category.match;
    rows.push(summary);

    if (category.csvName === undefined) return;
    if (!category.nameMatch) rows.push(textMismatch(range, `Category #${i + 1} name`, category.name, category.csvName));
    category.items.forEach((item, j) => {
      const label = `${where} · item #${j + 1} "${item.name}"`;
      if (item.csvName === undefined) rows.push(textMismatch(range, label, item.name, "(not in CSV)"));
      else {
        if (!item.nameMatch) rows.push(textMismatch(range, `${where} · item #${j + 1} name`, item.name, item.csvName));
        rows.push(...cellRows(range, label, item.cells));
      }
    });
    category.extraCsvItems.forEach((name) => rows.push(textMismatch(range, `${where} · extra CSV item`, "(not in report)", name)));
    if (!category.total.inCsv) rows.push(textMismatch(range, `${where} · Total row`, "Total", "(not in CSV)"));
    else rows.push(...cellRows(range, `${where} · Total`, category.total.cells));
  });

  detail.extraCsvCategories.forEach((name) => rows.push(textMismatch(range, "Extra CSV category", "(not in report)", name)));

  if (!detail.grandTotal.inCsv) rows.push(textMismatch(range, "Grand Total row", "Grand Total", "(not in CSV)"));
  else detail.grandTotal.cells.forEach((c) => rows.push(valueRow(range, `Grand Total · ${c.column}`, c.format, c.report, c.csv)));

  return rows;
}

// `table` is DetailedCategoryReportPage.readTable()'s answer.
function compareDetailedCategoryCsv(csvText, table, range) {
  const detail = buildDetail(csvText, table);
  return { detail, rows: summaryRows(detail, range) };
}

module.exports = { compareDetailedCategoryCsv };

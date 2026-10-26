// Each entry is a group of values, from different reports, that must all be
// equal for the same store and date range. `report` is a key from
// reportDefinitions.js; `path` is a lodash-style path into that report's JSON
// response; `label` is how the value is named in the logs and HTML report;
// `format` is how the values are displayed ("money" or "count").
// Adding a report to a comparison means adding a line to `values`; a new
// comparison means a new entry.

module.exports = [
  {
    label: "Net Sales",
    format: "money",
    values: [
      { label: "Dashboard Total Sales Revenue", report: "dashboard", path: "kpis.revenue.value" },
      { label: "Sales Summary Net Sales", report: "salesSummary", path: "result.gross_sales.net_sales" },
      { label: "Hourly Sales Total Sales", report: "hourlySales", path: "result.totals.total_net_sales" },
      { label: "Location Report Net Sales", report: "locationSales", path: "data.summary.totalNetSales" },
    ],
  },
  {
    label: "Transactions",
    format: "count",
    values: [
      { label: "Dashboard Total Transactions", report: "dashboard", path: "kpis.transactions.value" },
      { label: "Sales Summary Total Transactions", report: "salesSummary", path: "result.total_transactions" },
      { label: "Hourly Sales Total Transactions", report: "hourlySales", path: "result.totals.total_sales_count" },
      { label: "Location Report Sales Count", report: "locationSales", path: "data.summary.totalTransactions" },
    ],
  },
];

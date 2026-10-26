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
  {
    label: "Gross Profit",
    format: "money",
    values: [
      { label: "Dashboard Profit Generated", report: "dashboard", path: "kpis.profit.value" },
      { label: "Hourly Sales Gross Profit", report: "hourlySales", path: "result.totals.total_gross_profit" },
      { label: "Location Report Gross Profit", report: "locationSales", path: "data.summary.totalGrossProfit" },
    ],
  },
  {
    label: "Discounts Given $",
    format: "money",
    // The dashboard can be a few cents below the Discount and Location
    // reports on large ranges (seen live for monster01: 1 cent for a month,
    // 5 cents for the year) - most likely rounding per order/day before
    // summing. Accepted up to $0.05 on request; matching rows still say
    // "within ±$0.05" so the gap stays visible.
    tolerance: 0.05,
    values: [
      { label: "Dashboard Discounts Given $", report: "dashboard", path: "kpis.discount_amt.value" },
      { label: "Discount Report Net Discount Amount", report: "discountReport", path: "discount_data.total.total_discount_amt" },
      { label: "Location Report Net Discounts", report: "locationSales", path: "data.summary.totalNetDiscounts" },
    ],
  },
];

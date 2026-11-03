// Each entry is a group of values, from different reports, that must all be
// equal for the same store and date range. `report` is a key from
// reportDefinitions.js; `path` is a lodash-style path into that report's JSON
// response; `label` is how the value is named in the logs and HTML report;
// `format` is how the values are displayed ("money" or "count").
// A value the report's page works out itself (no field for it in the
// response) uses `compute: (body) => number` instead of `path`.
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
    label: "Average Order Value",
    format: "money",
    // The dashboard can round a half cent down (seen live for monster01:
    // $232.31 vs the Sales Summary's $232.32). Accepted up to $0.01 on
    // request; matching rows still say "within ±$0.01".
    tolerance: 0.01,
    values: [
      { label: "Dashboard Average Order Value", report: "dashboard", path: "kpis.aov.value" },
      // The Sales Summary's "Avg Transaction Value" isn't in its API response
      // - the page divides net sales by total transactions itself (confirmed
      // live: $20,424.14 ÷ 123 = $166.05), so this does the same.
      {
        label: "Sales Summary Avg Transaction Value",
        report: "salesSummary",
        compute: ({ result }) => {
          const transactions = Number(result.total_transactions);
          return transactions === 0 ? 0 : Number(result.gross_sales.net_sales) / transactions;
        },
      },
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
  {
    label: "Total Amount Collected",
    format: "money",
    values: [
      { label: "Sales Summary Total Amount Collected", report: "salesSummary", path: "result.total_amount_collected" },
      // The page's "Total Sales" is every order type's amount with tips
      // (confirmed live: Store B this year $125,733.43 + $300 tips =
      // $126,033.43, the Sales Summary's Total Amount Collected).
      {
        label: "Sales by Order Type Total Sales",
        report: "salesByOrderType",
        compute: ({ data }) => Cypress._.sumBy(data.current, (row) => Number(row.amount_with_tip)),
      },
    ],
  },
];

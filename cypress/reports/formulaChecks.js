// Each entry checks that a value a report shows equals what its own formula
// gives from that report's other values, for the same store and date range.
//
//   report   key from reportDefinitions.js the inputs and actual value come from
//   inputs   named values the formula needs: { label, path, format }
//   compute  the formula, given the inputs as numbers
//   display  how the formula reads in logs, given the inputs as "Label $1.00" text
//   actual   the value the report itself shows
//   format   how the expected and actual values are displayed ("money"/"count")
//
// Expected and actual are both compared at 2 decimals. Adding a formula check
// means adding an entry here.

module.exports = [
  {
    label: "Average Order Value",
    format: "money",
    report: "dashboard",
    inputs: {
      revenue: { label: "Total Sales Revenue", path: "kpis.revenue.value", format: "money" },
      transactions: { label: "Total Transactions", path: "kpis.transactions.value", format: "count" },
    },
    // No transactions in the range means no average - the dashboard shows
    // $0.00 for that, not a division error.
    compute: ({ revenue, transactions }) => (transactions === 0 ? 0 : revenue / transactions),
    display: ({ revenue, transactions }) => `${revenue} ÷ ${transactions}`,
    actual: { label: "Dashboard Average Order Value", path: "kpis.aov.value" },
  },
];

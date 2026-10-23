// Each entry says: this value in one report must equal that value in another
// report, for the same store and date range. `report` is a key from
// reportDefinitions.js; `path` is a lodash-style path into that report's JSON
// response; `label` is how the value is named in the logs and HTML report.
// Adding a new comparison means adding an entry here.

module.exports = [
  {
    left: { label: "Dashboard Total Sales Revenue", report: "dashboard", path: "kpis.revenue.value" },
    right: { label: "Sales Summary Net Sales", report: "salesSummary", path: "result.gross_sales.net_sales" },
  },
];

// Category report comparisons - same shape as reportMappings.js. The
// Category Sold Report labels gross sales "Subtotal" and net sales
// "Subtotal w/ Discounts".

// The Detailed Category API sends no grand_totals at all for a range with no
// sales ("No data found") - the page shows $0.00 for that.
const detailedTotal = (field) => (body) => (body.status === true ? body.grand_totals[field] : 0);

module.exports = [
  {
    label: "Category Gross Sales",
    format: "money",
    values: [
      { label: "Sales by Category Gross Sales", report: "salesByCategory", path: "total_subtotal" },
      { label: "Detailed Category Gross Sales", report: "detailedCategory", compute: detailedTotal("gross_sale") },
      { label: "Category Sold Subtotal", report: "categorySold", path: "total_subtotal" },
    ],
  },
  {
    label: "Category Net Sales",
    format: "money",
    values: [
      { label: "Sales by Category Net Sales", report: "salesByCategory", path: "total_subtotal_with_discounts" },
      { label: "Detailed Category Net Sales", report: "detailedCategory", compute: detailedTotal("product_total") },
      { label: "Category Sold Subtotal w/ Discounts", report: "categorySold", path: "total_subtotal_with_discounts" },
    ],
  },
];

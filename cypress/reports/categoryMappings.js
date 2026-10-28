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
  {
    label: "Category Quantity Sold",
    format: "count",
    values: [
      { label: "Sales by Category Quantity Sold", report: "salesByCategory", path: "total_qty" },
      { label: "Detailed Category Quantity", report: "detailedCategory", compute: detailedTotal("pro_qty") },
      // The Category Sold Report shows no quantity total, only a Sold Qty
      // per category row - so this adds up the rows of every page.
      {
        label: "Category Sold Sold Qty (sum of rows)",
        report: "categorySold",
        compute: (body) => Cypress._.sumBy(body.category_sale_data, (row) => Number(row.total_qty)),
      },
    ],
  },
  // Only these two reports show a discount total; the Detailed Category page
  // is left out of this check on request.
  {
    label: "Category Discounts",
    format: "money",
    values: [
      { label: "Sales by Category Discounts", report: "salesByCategory", path: "total_discounts" },
      // Shown on the page as a negative (-$4.44); the API sends it positive.
      { label: "Category Sold Discounts", report: "categorySold", path: "total_discounts" },
    ],
  },
];

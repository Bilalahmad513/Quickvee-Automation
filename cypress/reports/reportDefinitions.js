// One entry per report endpoint on reports-api.quickvee.us. Every report is
// called for the same store and the same start/end date - only what's listed
// here differs per report, so adding a new report means adding an entry here
// and nothing else.
//
//   format            "multipart": form fields; merchant_id/outlet_ids
//                     (context.storeIds)/start_date/end_date and the login
//                     fields are added for you.
//                     "json": JSON body + query string; merchant_id and the
//                     login fields are added to the body for you.
//   fields            extra form fields (multipart) or body fields (json)
//   query             query-string params (json only)
//   needsLocation     the request needs this store's {id, name, city, state}
//                     entry (context.location), looked up once per store
//   allPages          (optional) the API returns rows a page at a time:
//                     { rows: path to the rows, rowKey(row) identifying a row,
//                       hasMore(body), totalRows(body) }.
//                     Every page is fetched (fields/query get `page`) and the
//                     rows are combined into one body.
//   ok                how this API says the call succeeded
//   reportedRange     (optional) the date range the API says it actually used
//   reportedLocations (optional) the store ids the API says it actually used
//                     (null: the response has none to report, e.g. no data)
//
// The two "reported" checks keep a comparison from silently passing on a
// mismatched date range or a different set of stores.

module.exports = {
  dashboard: {
    format: "multipart",
    endpoint: "dashboard",
    // The UI's Day/Week/Month toggle only changes the trend chart - confirmed
    // live that kpis.* follows start_date/end_date for any custom range.
    fields: ({ range }) => ({
      date_range: `${range.startDate}_${range.endDate}`,
      activeType: "Day",
      date_type: "Day",
      isViewingCurrentPeriod: String(range.isCurrentPeriod),
      top_limit: "10",
    }),
    ok: (body) => body.status === true,
    reportedRange: (body) => ({ startDate: body.headline.start, endDate: body.headline.end }),
  },

  salesSummary: {
    format: "multipart",
    endpoint: "sales_report_api_fact",
    fields: () => ({}),
    ok: (body) => body.status === true,
  },

  hourlySales: {
    format: "multipart",
    endpoint: "hourly_sales_fact",
    fields: () => ({}),
    ok: (body) => body.status === true,
  },

  // discount_type "1,2,3,4,5" = all discount types (custom, coupon, loyalty
  // points, mix & match, BOGO) - what the Discount Report page sends.
  discountReport: {
    format: "multipart",
    endpoint: "discount_report_fact",
    fields: () => ({ discount_type: "1,2,3,4,5" }),
    ok: (body) => body.status === true,
    reportedRange: (body) => ({
      startDate: body.current_period.start_date.slice(0, 10),
      endDate: body.current_period.end_date.slice(0, 10),
    }),
    reportedLocations: (body) => body.merchant_ids,
  },

  // Sales by Category page (new-sale-report/sales-by-category). Totals cover
  // every category, not just the returned page.
  salesByCategory: {
    format: "multipart",
    endpoint: "category_sales_report_api_fact",
    fields: () => ({ cat_name: "All", page: "1", page_size: "500" }),
    ok: (body) => body.status === true,
  },

  // Detailed Category Report page (new-sale-report/detailed-category-report).
  // grand_totals covers every category, not just the returned page. A range
  // with no sales comes back as status false, "No data found" and no
  // grand_totals at all (categoryMappings.js reads that as $0.00).
  detailedCategory: {
    format: "multipart",
    endpoint: "detailed_category_sale_fact",
    fields: ({ context }) => ({
      category_id: "all",
      stores: context.storeIds.join(","),
      order_env: "1",
      order_typ: "all",
      order: "DESC",
      sorting_type: "categoryTotal",
      page: "1",
      page_size: "10",
    }),
    ok: (body) => body.status === true || body.message === "No data found",
    // Nothing to attribute to any store when there's no data.
    reportedLocations: (body) => (body.status === true ? body.merchant_ids : null),
  },

  // Category Sold Report page (store-reporting/category-sold-report): same
  // API as Sales by Category, but the page sends its own paging/sorting and
  // opens with every store on the account selected in outlet_ids. This sends
  // context.storeIds, like the other reports. The page shows no quantity
  // total - its Sold Qty column is added up from the rows, so every page of
  // rows (25 per page, same as the page) is fetched.
  //
  // Sorted by category name, not by subtotal like the page: confirmed live
  // that paging by subtotal isn't stable - categories with equal subtotals
  // (e.g. many at $0) swap places between calls, so the same category came
  // back on two pages and another on none (6 out of 6 tries, quantity off by
  // up to 2). By name, 4 out of 4 tries gave every category exactly once.
  categorySold: {
    format: "multipart",
    endpoint: "category_sales_report_api_fact",
    fields: ({ page }) => ({
      search_by: "",
      sort_field: "category_name",
      sort_order: "asc",
      page: String(page),
      page_size: "25",
    }),
    allPages: {
      rows: "category_sale_data",
      rowKey: (row) => JSON.stringify(row.category_ids),
      hasMore: (body) => body.has_more === true,
      totalRows: (body) => body.total_categories,
    },
    ok: (body) => body.status === true,
  },

  // Same Category Sold data, with every category on one page - what the
  // Export CSV check compares the CSV's rows against.
  categorySoldAllRows: {
    format: "multipart",
    endpoint: "category_sales_report_api_fact",
    fields: () => ({
      search_by: "",
      sort_field: "subtotal",
      sort_order: "desc",
      page: "1",
      page_size: "10000",
    }),
    ok: (body) => body.status === true,
  },

  // The Location Report page opens with every store selected; "Deselect All"
  // leaves only the current store, and the page then sends just that one
  // store's entry in `locations` (confirmed live). This sends the same
  // single-store request, and reportedLocations confirms the API really used
  // only this store rather than totalling all of them.
  locationSales: {
    format: "json",
    endpoint: "location-sales-fact",
    needsLocation: true,
    query: ({ context, range }) => ({
      start_date: range.startDate,
      end_date: range.endDate,
      merchant_id: context.merchantId,
      page: 1,
      page_size: 50,
      sort_by: "netSales",
      sort_order: "desc",
    }),
    fields: ({ context }) => ({ locations: [context.location] }),
    ok: (body) => body.status === "success",
    reportedRange: (body) => ({ startDate: body.data.dateRange.startDate, endDate: body.data.dateRange.endDate }),
    reportedLocations: (body) => body.data.locations.map((l) => l.locationId),
  },
};

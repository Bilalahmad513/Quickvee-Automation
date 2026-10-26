// One entry per report endpoint on reports-api.quickvee.us. Every report is
// called for the same store and the same start/end date - only what's listed
// here differs per report, so adding a new report means adding an entry here
// and nothing else.
//
//   format            "multipart": form fields; merchant_id/outlet_ids/
//                     start_date/end_date and the login fields are added for you.
//                     "json": JSON body + query string; merchant_id and the
//                     login fields are added to the body for you.
//   fields            extra form fields (multipart) or body fields (json)
//   query             query-string params (json only)
//   needsLocation     the request needs this store's {id, name, city, state}
//                     entry (context.location), looked up once per store
//   ok                how this API says the call succeeded
//   reportedRange     (optional) the date range the API says it actually used
//   reportedLocations (optional) the store ids the API says it actually used
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

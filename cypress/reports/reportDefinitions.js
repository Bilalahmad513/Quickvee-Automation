// One entry per report endpoint on reports-api.quickvee.us. Every report is
// called with the same store (merchant_id/outlet_ids) and the same
// start_date/end_date - only the extra fields below differ per report, so
// adding a new report means adding an entry here and nothing else.
//
// `reportedRange` (optional) reads back the date range the API says it
// actually used, so a comparison can't silently pass on mismatched ranges.

module.exports = {
  dashboard: {
    endpoint: "dashboard",
    // The UI's Day/Week/Month toggle only changes the trend chart - confirmed
    // live that kpis.* follows start_date/end_date for any custom range.
    extraFields: ({ startDate, endDate, isCurrentPeriod }) => ({
      date_range: `${startDate}_${endDate}`,
      activeType: "Day",
      date_type: "Day",
      isViewingCurrentPeriod: String(isCurrentPeriod),
      top_limit: "10",
    }),
    reportedRange: (body) => ({ startDate: body.headline.start, endDate: body.headline.end }),
  },

  salesSummary: {
    endpoint: "sales_report_api_fact",
    extraFields: () => ({}),
  },
};

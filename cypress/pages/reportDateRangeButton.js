// The date range button ("11/04/2026 - 11/04/2026") on the newer report
// pages - Item Sold Report and Category Sold Report (confirmed live, same
// component on both). It opens a react-day-picker range calendar with
// presets beside it and Cancel / Retrieve below. Presets are used where the
// page has one - a preset applies at once and closes the calendar
// (confirmed live), so there's no Retrieve to click. Any other range is
// picked in the calendar (first click = start, second click = end), then
// Retrieve.

const PRESETS = { today: "Today", yesterday: "Yesterday", "this month": "Month-to-date", "this year": "This year" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const calendar = () => cy.get('[role="dialog"]:visible', { timeout: 10000 }).last();

// Steps the calendar to `date`'s month ("Go to previous/next month"), then
// clicks that day. The grid also shows the neighbouring months' days, so the
// day is counted from the month's own "1" - the first cell reading 1.
function pickCalendarDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  const target = `${MONTHS[month - 1]} ${year}`;

  const stepTo = (stepsLeft) =>
    calendar()
      .find('[aria-live="polite"]')
      .invoke("text")
      .then((shown) => {
        if (shown.trim() === target) return;
        if (stepsLeft === 0) throw new Error(`Calendar never reached ${target} (still on ${shown}).`);
        const [name, shownYear] = shown.trim().split(" ");
        const back = Number(shownYear) * 12 + MONTHS.indexOf(name) > year * 12 + (month - 1);
        calendar().find(`button[name="${back ? "previous-month" : "next-month"}"]`).click();
        calendar().find('[aria-live="polite"]').should("not.have.text", shown);
        stepTo(stepsLeft - 1);
      });
  stepTo(24);

  return calendar()
    .find('button[name="day"]')
    .then(($days) => {
      const first = $days.toArray().findIndex((el) => el.textContent.trim() === "1");
      cy.wrap($days.eq(first + day - 1)).click();
    });
}

// `range`: { label, startDate, endDate } ("YYYY-MM-DD").
function selectReportDates(range) {
  cy.contains("button", /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/, { timeout: 15000 }).click();
  if (PRESETS[range.label]) {
    return calendar().contains("button", new RegExp(`^${PRESETS[range.label]}$`)).click();
  }
  pickCalendarDay(range.startDate);
  pickCalendarDay(range.endDate);
  return calendar().contains("button", /^Retrieve$/).click();
}

module.exports = { selectReportDates };

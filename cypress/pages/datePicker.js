// Start Date / End Date fields and the calendars behind them. Two kinds
// (confirmed live):
// - report pages (e.g. Sales by Order Type): a readonly input that opens a
//   react-datepicker calendar when clicked.
// - the Orders page: an MUI date field - clicking it only places the cursor,
//   typing into it doesn't change the date, and its "Choose date" button
//   opens an MUI calendar.
// Either way the date is picked in the calendar.
//
// The Orders page reloads its list after every date pick, and that reload
// re-renders the page - confirmed live that it can shut an open calendar
// or swap its buttons out mid-click (more so in the interactive runner). So
// a pick isn't trusted to have worked: the field is checked afterwards and
// the pick tried again if it doesn't show the date. Clicks inside the
// calendar are plain DOM clicks on whatever is there right then, so a
// calendar that shut (or a button that was replaced) means "look again",
// not a failed test.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CALENDARS = {
  reactDatepicker: {
    open: (input) => input().click(),
    monthLabel: ".react-datepicker__current-month:visible",
    previous: ".react-datepicker__navigation--previous:visible",
    next: ".react-datepicker__navigation--next:visible",
    // Days shown from the neighbouring months are skipped, so "1" is this
    // month's 1st.
    day: ($body, day) =>
      $body.find(`.react-datepicker__day--${String(day).padStart(3, "0")}:not(.react-datepicker__day--outside-month):visible`),
  },
  mui: {
    open: (input) => input().parents(".MuiInputBase-root").first().find('button[aria-label^="Choose date"]').click(),
    monthLabel: ".MuiPickersPopper-root .MuiPickersCalendarHeader-label:visible",
    previous: '.MuiPickersPopper-root button[aria-label="Previous month"]:visible',
    next: '.MuiPickersPopper-root button[aria-label="Next month"]:visible',
    day: ($body, day) =>
      $body
        .find(".MuiPickersPopper-root button.MuiPickersDay-root:not(.MuiPickersDay-dayOutsideMonth):visible")
        .filter((i, el) => el.textContent.trim() === String(day)),
  },
};

// The input under a "Start Date" / "End Date" label: the nearest ancestor of
// the label that holds an input. Works on both kinds, whose label markup
// differs (the Orders page puts an icon beside the text).
function dateInputByLabel(label) {
  return cy
    .contains(new RegExp(`^${label}$`), { timeout: 15000 })
    .parents()
    .filter((i, el) => el.querySelector("input") !== null)
    .first()
    .find("input")
    .first();
}

// The same input, looked up in `$body` right now (no retrying) - for
// checking its value inside waitUntil().
function dateInputValue($body, label) {
  const $label = $body.find("label, div, span, p").filter((i, el) => el.textContent.trim() === label).first();
  return $label.closest(":has(input)").find("input").first().val();
}

// "June 2026" -> months since year 0, so two calendar months compare.
function monthIndex(text) {
  const [name, year] = text.trim().split(" ");
  return Number(year) * 12 + MONTHS.indexOf(name);
}

// "2026-10-01" -> "10/01/2026", how both kinds of field show a date.
function shownAs(date) {
  const [year, month, day] = date.split("-");
  return `${month}/${day}/${year}`;
}

// Checks the page every 250ms, for up to `ms`, until `check($body)` is true;
// yields whether it became true. Unlike cy.get(), running out of time isn't
// a failure - the caller decides what to do next.
function waitUntil(check, ms) {
  return cy.get("body", { log: false }).then(($body) => {
    if (check($body)) return true;
    if (ms <= 0) return false;
    cy.wait(250, { log: false });
    return waitUntil(check, ms - 250);
  });
}

// One go at picking `date` ("YYYY-MM-DD"): opens the calendar, steps month
// by month to the date's month, clicks the day. Stops quietly as soon as
// the calendar isn't there - pickDate() checks the field and tries again.
// After each step it waits for the month label to change, so a label read
// mid-animation can't cause an extra step.
function tryPickDate(calendar, input, date) {
  const [year, month, day] = date.split("-").map(Number);
  const target = year * 12 + (month - 1);
  const calendarOpen = ($body) => $body.find(calendar.monthLabel).length > 0;

  const step = (stepsLeft) =>
    waitUntil(calendarOpen, 5000).then((open) => {
      if (!open) return;
      cy.get("body", { log: false }).then(($body) => {
        const shown = $body.find(calendar.monthLabel).first().text().trim();
        const current = monthIndex(shown);
        if (current === target) {
          const $day = calendar.day($body, day).first();
          if ($day.length) $day[0].click();
          return;
        }
        if (stepsLeft === 0) throw new Error(`Date picker never reached ${date} (still on ${shown}).`);
        const $button = $body.find(current > target ? calendar.previous : calendar.next).first();
        if (!$button.length) return;
        $button[0].click();
        waitUntil(($now) => !$now.find(calendar.monthLabel).text().includes(shown), 5000);
        step(stepsLeft - 1);
      });
    });

  calendar.open(input);
  return step(36);
}

// Picks `date` in the field under `label`, until the field shows it. Any
// calendar left open by a go that didn't land is shut (Escape) first.
function pickDate(calendar, label, date, attemptsLeft = 4) {
  tryPickDate(calendar, () => dateInputByLabel(label), date);
  return waitUntil(($body) => dateInputValue($body, label) === shownAs(date), 5000).then((picked) => {
    if (picked) return;
    if (attemptsLeft <= 1) throw new Error(`Couldn't set ${label} to ${shownAs(date)} in the date picker.`);
    cy.get("body").type("{esc}");
    return pickDate(calendar, label, date, attemptsLeft - 1);
  });
}

// Picks a { startDate, endDate } range ("YYYY-MM-DD") in the Start Date /
// End Date fields. `kind`: "reactDatepicker" or "mui" (see CALENDARS).
function pickDateRange(kind, range) {
  const calendar = CALENDARS[kind];
  pickDate(calendar, "Start Date", range.startDate);
  return pickDate(calendar, "End Date", range.endDate);
}

module.exports = { pickDateRange };

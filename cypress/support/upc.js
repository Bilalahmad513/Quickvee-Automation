// UPC-A: 11 data digits plus a check digit. Digits in odd positions (1st,
// 3rd, ... 11th) count three times, even positions once; the check digit
// brings the sum up to a multiple of 10.
function upcCheckDigit(elevenDigits) {
  const sum = elevenDigits
    .split("")
    .reduce((acc, digit, i) => acc + Number(digit) * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

function isValidUpcA(upc) {
  return /^\d{12}$/.test(upc) && upcCheckDigit(upc.slice(0, 11)) === upc[11];
}

// 12-digit UPC-A from the run id and the product's index, plus random digits
// so a regenerated candidate differs from the previous one.
function buildUpc(runId, index) {
  const random = String(Cypress._.random(0, 999)).padStart(3, "0");
  const data = `${String(runId).slice(-6)}${String(index).padStart(2, "0")}${random}`.slice(0, 11);
  return data + upcCheckDigit(data);
}

module.exports = { upcCheckDigit, isValidUpcA, buildUpc };

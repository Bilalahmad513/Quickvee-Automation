// Shared by every spec that creates a product, so test products read like
// real catalog items ("Bluetooth Speaker 48213") instead of giving away that
// they're test data ("Simple Product 48213"). The trailing digits stay -
// several specs search the storefront for the exact name afterward, and a
// plain name with no unique part would collide with products earlier runs
// already left behind in the same store.
const PRODUCT_NAME_POOL = [
  "Wireless Mouse",
  "Bluetooth Speaker",
  "Stainless Steel Bottle",
  "Leather Wallet",
  "Ceramic Coffee Mug",
  "Yoga Mat",
  "Desk Lamp",
  "Canvas Backpack",
  "Polarized Sunglasses",
  "Phone Case",
  "Running Shoes",
  "Notebook Set",
  "Travel Mug",
  "Scented Candle",
  "Reusable Water Flask",
  "Charging Cable",
  "Laptop Stand",
  "Wireless Earbuds Case",
  "Fleece Blanket",
  "Insulated Lunch Box",
];

function randomProductName() {
  const base = Cypress._.sample(PRODUCT_NAME_POOL);
  return `${base} ${Date.now().toString().slice(-5)}`;
}

// Price fields only ever need cost < price - the exact numbers were never
// meaningful, just hardcoded placeholders, so this picks a random cost and
// adds a random margin on top instead.
function randomPricePair({ minCost = 10, maxCost = 50, minMargin = 5, maxMargin = 20 } = {}) {
  const cost = Cypress._.random(minCost, maxCost);
  const price = cost + Cypress._.random(minMargin, maxMargin);
  return { cost: cost.toFixed(2), price: price.toFixed(2) };
}

module.exports = { randomProductName, randomPricePair };

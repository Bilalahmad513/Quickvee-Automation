const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");
const reportsApi = require("../reports/ReportsApi");
const { randomProductName, randomPricePair } = require("../support/testData");

// Creates PRODUCT_COUNT single products in this store, each with a unique
// name and SKU, a category/brand/tag, cost and price, stock and a photo.
// Override with --env productStore=<store>,productStoreId=<merchant id>,productCount=<n>.
const STORE = Cypress.env("productStore") || "monster04";
const STORE_ID = Cypress.env("productStoreId") || "BIL1456474NC";
const PRODUCT_COUNT = Number(Cypress.env("productCount") || 10);

const PHOTOS = ["red", "blue", "green", "purple", "teal"].map((c) => `cypress/fixtures/product-images/product-${c}.png`);

// Unique per run and per product, letters and digits only (max 30 chars).
const RUN_ID = Date.now().toString().slice(-7);
const skuFor = (n) => `QVA${RUN_ID}${String(n).padStart(2, "0")}`;

// No retries: a retry after a save that went through would add an extra
// product instead of redoing the same one.
describe("Product Creation", { retries: 0 }, () => {
  const created = [];

  before(() => {
    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), STORE);
    // The dashboard's own reports call says which store the session is in.
    reportsApi.captureContext().then((context) => {
      expect(context.merchantId, `inside store ${STORE}`).to.equal(STORE_ID);
    });
  });

  beforeEach(() => {
    cy.loginAndEnterStore(Cypress.env("storeName"), Cypress.env("username"), Cypress.env("password"), STORE);
    productsPage.visit();
  });

  after(() => {
    cy.task("log", `Products created in ${STORE} (${STORE_ID}):\n` + created.map((p) => `  ${p.n}. ${p.name} | SKU ${p.sku} | cost ${p.cost} | price ${p.price}`).join("\n"));
  });

  Cypress._.times(PRODUCT_COUNT, (i) => {
    const n = i + 1;

    it(`creates product ${n} of ${PRODUCT_COUNT} in ${STORE} (name, SKU, price, photo)`, () => {
      const name = randomProductName();
      const sku = skuFor(n);
      const { cost, price } = randomPricePair();

      productsPage.clickAddProduct();
      productsPage.chooseSingleProductType();

      productFormPage.fillName(name);
      productFormPage.attachPhoto(PHOTOS[i % PHOTOS.length]);
      productFormPage.selectRandomCategory();
      productFormPage.selectRandomBrand();
      productFormPage.selectRandomTag();
      productFormPage.fillSimplePricing(cost, price);
      productFormPage.fillAvailableToSell();
      productFormPage.fillSku(sku);
      productFormPage.save();

      productFormPage.assertAddedSuccessfully();
      cy.then(() => {
        created.push({ n, name, sku, cost, price });
        Cypress.log({ name: "created", message: `**${name}** · SKU ${sku} · cost $${cost} · price $${price}` });
      });
    });
  });
});

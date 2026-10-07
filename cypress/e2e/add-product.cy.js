const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");

const SIZE_VALUE_POOL = ["Small", "Medium", "Large", "X-Large", "X-Small"];

describe("Add Product", () => {
  beforeEach(() => {
    cy.loginAndEnterStore(
      Cypress.env("storeName"),
      Cypress.env("username"),
      Cypress.env("password"),
      Cypress.env("storeUnderTest")
    );
    productsPage.visit();
  });

  it("creates a simple (single) product", () => {
    productsPage.clickAddProduct();
    productsPage.chooseSingleProductType();

    productFormPage.fillName("Simple Product " + Date.now().toString().slice(-5));
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.fillSimplePricing("15.00", "25.00");
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });

  it("creates a product with variants", () => {
    productsPage.clickAddProduct();
    productsPage.chooseVariantProductType();

    const [valueA, valueB] = Cypress._.sampleSize(SIZE_VALUE_POOL, 2);

    productFormPage.fillName("Variant Product " + Date.now().toString().slice(-5));
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.selectAttribute("Size");
    productFormPage.addVariantValue(valueA);
    productFormPage.addVariantValue(valueB);
    productFormPage.fillAllVariantPrices("20.00", "30.00");
    productFormPage.fillAllVariantAvailableToSell();
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });
});


const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");
const { randomProductName, randomPricePair } = require("../support/testData");

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

    const simplePricing = randomPricePair();

    productFormPage.fillName(randomProductName());
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.fillSimplePricing(simplePricing.cost, simplePricing.price);
    productFormPage.fillAvailableToSell();
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });

  it("creates a product with variants", () => {
    productsPage.clickAddProduct();
    productsPage.chooseVariantProductType();

    const [valueA, valueB] = Cypress._.sampleSize(SIZE_VALUE_POOL, 2);
    const variantPricing = randomPricePair();

    productFormPage.fillName(randomProductName());
    productFormPage.selectRandomCategory();
    productFormPage.selectRandomBrand();
    productFormPage.selectRandomTag();
    productFormPage.selectAttribute("Size");
    productFormPage.addVariantValue(valueA);
    productFormPage.addVariantValue(valueB);
    productFormPage.fillAllVariantPrices(variantPricing.cost, variantPricing.price);
    productFormPage.fillAllVariantAvailableToSell();
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });
});


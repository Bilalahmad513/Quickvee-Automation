const loginPage = require("../pages/LoginPage");
const storeDirectoryPage = require("../pages/StoreDirectoryPage");
const productsPage = require("../pages/ProductsPage");
const productFormPage = require("../pages/ProductFormPage");

describe("Add Product", () => {
  beforeEach(() => {
    loginPage.login(
      Cypress.env("storeName"),
      Cypress.env("username"),
      Cypress.env("password")
    );
    storeDirectoryPage.enterStore(Cypress.env("storeUnderTest"));
    productsPage.visit();
  });

  it("creates a simple (single) product", () => {
    productsPage.clickAddProduct();
    productsPage.chooseSingleProductType();

    productFormPage.fillName("Cypress Simple Product " + Date.now());
    productFormPage.selectCategory("CAT 10");
    productFormPage.fillSimplePrice("25.00");
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });

  it("creates a product with variants", () => {
    productsPage.clickAddProduct();
    productsPage.chooseVariantProductType();

    productFormPage.fillName("Cypress Variant Product " + Date.now());
    productFormPage.selectCategory("CAT 10");
    productFormPage.selectAttribute("Size");
    productFormPage.addVariantValue("Small");
    productFormPage.addVariantValue("Large");
    productFormPage.fillAllVariantPrices("30.00");
    productFormPage.save();

    productFormPage.assertAddedSuccessfully();
  });
});

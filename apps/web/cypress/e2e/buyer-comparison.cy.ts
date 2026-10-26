/** The buyer compares five bids on Rohbau Haus B and sees what is wrong with them. */
describe("price comparison", () => {
  beforeEach(() => {
    cy.demo().then((d) => cy.visitAs(d.contractor.email, "/tenders"));
  });

  it("lists the tenders and opens the comparison", () => {
    cy.contains("h1", "Tenders");
    cy.contains("Rohbau Haus B").click();
    cy.location("pathname").should("match", /^\/tenders\/[0-9a-f-]+$/);
    cy.get("[data-cy=comparison-grid]").should("be.visible");
    cy.get("[data-cy=bid-column]").should("have.length", 5);
    cy.contains("[role=tab]", "Price comparison").should("have.attr", "aria-selected", "true");
  });

  it("flags the decimal slip and explains the market price", () => {
    cy.demo().then((d) => {
      cy.visit(`/tenders/${d.tenders.rohbau}`);
      cy.get("input[aria-label='Find position']").type(d.slipOz);
      cy.get(`[data-oz='${d.slipOz}'] [data-flag=decimal_slip]`).should("have.length", 1);
      cy.get(`[data-oz='${d.slipOz}'] button`).first().click();
      cy.get(`[aria-label='Market price for ${d.slipOz}']`)
        .should("be.visible")
        .within(() => {
          cy.get("[data-cy=median]").invoke("text").should("match", /€/);
        });
      cy.get("body").type("{esc}");
      cy.get(`[aria-label='Market price for ${d.slipOz}']`).should("not.exist");
    });
  });

  it("filters to flagged prices and selects a bid to award", () => {
    cy.demo().then((d) => cy.visit(`/tenders/${d.tenders.rohbau}`));
    cy.contains("button", "Flagged prices").click().should("have.attr", "aria-pressed", "true");
    cy.get("[data-cy=comparison-grid] [role=row][data-oz]").should("have.length.greaterThan", 0);
    cy.get("[data-cy=comparison-grid] [role=gridcell][data-flag]").should("exist");
    cy.get("[data-cy=bid-column]").first().click();
    cy.get("[data-cy=award]").should("contain.text", "Award to");
  });

  it("shows the large tender without slowing down", () => {
    cy.demo().then((d) => cy.visit(`/tenders/${d.tenders.klinikum}`));
    cy.get("[data-cy=bid-column]").should("have.length", 25);
    // Virtualised: 2,000 positions, only the visible rows are in the page.
    cy.get("[data-cy=comparison-grid] [role=row][data-oz]").its("length").should("be.lessThan", 120);
    cy.get("[data-cy=comparison-grid]").scrollTo("bottom");
    cy.get("[data-cy=comparison-grid] [role=row][data-oz]")
      .last()
      .invoke("attr", "data-oz")
      .should("match", /^\d/);
  });
});

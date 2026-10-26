/** The buyer changes a quantity in an open tender; the bidder who already priced it sees why. */
describe("addendum", () => {
  it("publishes a new version from the bill of quantities", () => {
    cy.demo().then((d) => cy.visitAs(d.contractor.email, `/tenders/${d.tenders.trockenbau}`));
    cy.contains("[role=tab]", "Bill of quantities").click();
    cy.get("[data-cy=prepare-addendum]").click();
    cy.get("input[aria-label^='Quantity']").first().clear().type("999");
    cy.contains("button", "Review 1 changes").click();
    cy.get("[role=dialog]").within(() => {
      cy.contains("Publish addendum (version 2)");
      cy.get("textarea").first().type("Menge Wand Achse 1 korrigiert");
      cy.contains("button", "Publish to bidders").click();
    });
    cy.get("select#version").should("have.value", "2");
    cy.contains("1 changes against version 1");
  });

  it("tells a bidder on the old version what changed", () => {
    cy.demo().then((d) => cy.visitAs(d.roles.bidBeforeAddendum, `/bids/${d.tenders.rohbau}`));
    cy.get("[data-cy=addendum-banner]").should("contain.text", "version 1 to 2");
    cy.get("[data-change=work]")
      .should("have.length.at.least", 1)
      .first()
      .should("contain.text", "Changed: price again");
    // The old price for changed work is not shown as if it still stood.
    cy.get("[data-change=work] input").first().should("have.value", "");
  });
});

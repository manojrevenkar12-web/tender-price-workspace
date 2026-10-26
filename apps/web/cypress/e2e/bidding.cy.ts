/** A subcontractor prices a bid: autosave, a colleague's conflicting save, and submit. */
describe("bidding", () => {
  it("lists the invitations", () => {
    cy.demo().then((d) => cy.visitAs(d.roles.viewedOnly, "/bids"));
    cy.get("[data-cy=invitation]").should("have.length.at.least", 1);
    cy.contains("[data-cy=invitation]", "Rohbau Haus B").should("contain.text", "Not started");
  });

  it("autosaves a price and keeps it after a reload", () => {
    cy.demo().then((d) => {
      cy.visitAs(d.roles.viewedOnly, `/bids/${d.tenders.rohbau}`);
      cy.get("input[aria-label^='Unit price for']").first().clear().type("123,45");
      cy.contains("Unsaved changes");
      cy.contains("All prices saved");
      cy.reload();
      cy.get("input[aria-label^='Unit price for']").first().should("have.value", "123,45");
    });
  });

  it("refuses to submit an incomplete bid and shows what is missing", () => {
    cy.demo().then((d) => cy.visitAs(d.roles.viewedOnly, `/bids/${d.tenders.rohbau}`));
    cy.get("[data-cy=submit-bid]").click();
    cy.contains(/positions have no price/);
    cy.get("[role=row][data-oz] input[aria-label^='Unit price for']").first().should("exist");
  });

  it("does not overwrite a colleague's prices", () => {
    cy.demo().then((d) => {
      const url = `/api/tenders/${d.tenders.rohbau}/bid`;
      cy.visitAs(d.roles.viewedOnly, `/bids/${d.tenders.rohbau}`).then((s) => {
        const headers = { authorization: `Bearer ${s.token}` };
        cy.get("input[aria-label^='Unit price for']").first().should("have.value", "123,45");
        cy.get("input[aria-label^='Unit price for']")
          .first()
          .invoke("attr", "aria-label")
          .then((label) => {
            const oz = String(label).replace("Unit price for ", "");
            // A colleague saves in between, from another browser.
            cy.request({ url, headers })
              .its("body.bid.revision")
              .then((revision: number) =>
                cy.request({ method: "PUT", url, headers, body: { revision, prices: { [oz]: 20_000 } } }),
              );
          });
      });
      cy.get("input[aria-label^='Unit price for']").first().clear().type("130");
      cy.get("[role=alert]").should("contain.text", "Someone else in your company saved prices");
      cy.contains("button", "Load their version").click();
      cy.get("input[aria-label^='Unit price for']").first().should("have.value", "200,00");
      cy.contains("All prices saved");
    });
  });

  it("submits again after a bid was already in", () => {
    cy.demo().then((d) => {
      cy.visitAs(d.roles.bidAfterAddendum, `/bids/${d.tenders.rohbau}`);
      cy.contains("Submitted");
      cy.get("[data-cy=addendum-banner]").should("not.exist");
      cy.get("[data-cy=submit-bid]").should("contain.text", "Submit again").click();
      cy.contains("Bid submitted");
    });
  });
});

/** What one company must never see of another's, checked through the browser and the API. */
describe("tenancy", () => {
  it("a rival contractor does not see Kranich's tenders", () => {
    cy.demo().then((d) => {
      cy.visitAs(d.otherContractor.email, "/tenders");
      cy.contains("h1", "Tenders");
      cy.contains("Rohbau Haus B").should("not.exist");
      cy.visit(`/tenders/${d.tenders.rohbau}`);
      cy.get("[role=alert]").should("contain.text", "could not be loaded");
    });
  });

  it("a bidder cannot open the buyer's comparison", () => {
    cy.demo().then((d) => {
      cy.signIn(d.roles.bidBeforeAddendum).then((s) => {
        cy.request({
          url: `/api/tenders/${d.tenders.rohbau}/comparison`,
          headers: { authorization: `Bearer ${s.token}` },
          failOnStatusCode: false,
        })
          .its("status")
          .should("be.oneOf", [403, 404]);
      });
      cy.visitAs(d.roles.bidBeforeAddendum, `/tenders/${d.tenders.rohbau}`);
      cy.location("pathname").should("eq", "/bids");
    });
  });

  it("a company that was not invited sees nothing of the tender", () => {
    cy.demo().then((d) => {
      cy.signIn(d.roles.invitedNotStarted).then((s) => {
        cy.request({
          url: `/api/tenders/${d.tenders.rohbau}/bid`,
          headers: { authorization: `Bearer ${s.token}` },
          failOnStatusCode: false,
        })
          .its("status")
          .should("eq", 404);
      });
    });
  });
});

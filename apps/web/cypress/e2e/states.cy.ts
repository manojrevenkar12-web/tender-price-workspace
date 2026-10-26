/** Loading, error and empty states are real screens, not blank pages. */
describe("states", () => {
  it("shows a skeleton while loading and a retry when the server fails", () => {
    cy.demo().then((d) => {
      // The first load and the app's two automatic retries fail; the user's retry reaches the server.
      cy.intercept({ method: "GET", pathname: "/api/tenders", times: 3 }, (req) =>
        req.reply({
          delay: 600,
          statusCode: 503,
          body: { error: "unavailable", message: "Service unavailable" },
        }),
      );
      cy.visitAs(d.contractor.email, "/tenders");
      cy.get("[role=status]").should("exist");
      cy.get("[role=alert]").should("contain.text", "unavailable");
      cy.contains("button", "Try again").click();
      cy.contains("Rohbau Haus B");
    });
  });

  it("shows an empty comparison for a draft tender", () => {
    cy.demo().then((d) => cy.visitAs(d.contractor.email, `/tenders/${d.tenders.fliesen}`));
    cy.contains("No bids submitted yet");
  });

  it("signs in from the login screen", () => {
    cy.visit("/login");
    cy.get("[data-cy=demo-user]").should("have.length.at.least", 2).first().click();
    cy.location("pathname").should("eq", "/tenders");
  });
});

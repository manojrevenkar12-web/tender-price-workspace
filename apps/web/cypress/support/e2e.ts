/** Sign-in without the login screen: ask the API for a session and put it where the app keeps it. */
export interface Demo {
  contractor: { id: string; email: string };
  otherContractor: { id: string; email: string };
  tenders: Record<"rohbau" | "trockenbau" | "fliesen" | "elektro" | "klinikum", string>;
  roles: Record<"bidBeforeAddendum" | "bidAfterAddendum" | "viewedOnly" | "invitedNotStarted", string>;
  slipOz: string;
}

interface SignedIn {
  token: string;
  user: { kind: string };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      demo(): Chainable<Demo>;
      signIn(email: string): Chainable<SignedIn>;
      visitAs(email: string, path: string): Chainable<SignedIn>;
    }
  }
}

Cypress.Commands.add("demo", () => cy.fixture<Demo>("demo.json"));

Cypress.Commands.add("signIn", (email: string) =>
  cy.request<SignedIn>("POST", "/api/session", { email }).its("body"),
);

Cypress.Commands.add("visitAs", (email: string, path: string) =>
  cy.signIn(email).then((s) =>
    cy
      .visit(path, {
        onBeforeLoad(win) {
          win.localStorage.setItem("tpw.session", JSON.stringify(s));
        },
      })
      .then(() => s),
  ),
);

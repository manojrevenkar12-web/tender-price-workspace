import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { describe as describeActivity } from "../src/features/tenders/ActivityFeed";
import { FLAG, worst } from "../src/features/comparison/flags";
import { PriceStrip } from "../src/features/comparison/PriceStrip";
import { EmptyState, QueryState, SkeletonRows } from "../src/shared/ui";

function Harness({ fn }: { fn: () => Promise<string[]> }) {
  const q = useQuery({ queryKey: ["x", fn], queryFn: fn, retry: false });
  return (
    <QueryState
      query={q}
      skeleton={<SkeletonRows rows={2} label="Loading things" />}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title="Nothing here" />}
    >
      {(d) => (
        <ul>
          {d.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </QueryState>
  );
}

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("QueryState", () => {
  it("shows a skeleton, then the content", async () => {
    wrap(<Harness fn={async () => ["Rohbau"]} />);
    expect(screen.getByRole("status", { name: "Loading things" })).toBeInTheDocument();
    expect(await screen.findByText("Rohbau")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    wrap(<Harness fn={async () => []} />);
    expect(await screen.findByRole("heading", { name: "Nothing here" })).toBeInTheDocument();
  });

  it("shows the error and retries", async () => {
    let calls = 0;
    wrap(
      <Harness
        fn={async () => {
          calls++;
          if (calls === 1) throw new Error("Server unavailable");
          return ["Second try"];
        }}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Second try")).toBeInTheDocument();
  });
});

describe("PriceStrip", () => {
  it("draws the market band, the median and one dot per bid", () => {
    const { container } = render(
      <PriceStrip
        market={{ p10: 9_000, p50: 10_000, p90: 11_000 }}
        dots={[
          { value: 9_500, kind: "plain" },
          { value: 1_000, kind: "flag" },
          { value: 10_500, kind: "stale", active: true },
        ]}
        label="Market"
      />,
    );
    expect(container.querySelectorAll("rect")).toHaveLength(1);
    expect(container.querySelectorAll("circle")).toHaveLength(3);
    expect(screen.getByRole("img", { name: "Market" })).toBeInTheDocument();
  });

  it("draws nothing for a position without prices", () => {
    const { container } = render(<PriceStrip market={null} dots={[]} label="None" />);
    expect(container.querySelectorAll("circle")).toHaveLength(0);
  });
});

describe("flags and activity", () => {
  it("shows the most serious flag of a cell", () => {
    expect(worst(["above_market", "decimal_slip"])).toBe("decimal_slip");
    expect(worst([])).toBeNull();
    expect(Object.values(FLAG).every((f) => f.explain.length > 10)).toBe(true);
  });

  it("describes events in plain words", () => {
    const e = {
      id: 1,
      kind: "bid_rebased",
      actor: "Spree Rohbau",
      actorOrg: "x",
      at: "",
      payload: { to: 2, dropped: ["01", "02"] },
    };
    expect(describeActivity(e)).toBe("moved its bid to version 2; 2 prices for changed work were dropped");
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBidEditor } from "../src/features/bidding/useBidEditor";
import type { Bid } from "../src/shared/api/types";

const bid = (revision: number, prices: Record<string, number> = {}): Bid => ({
  id: "b1",
  tenderId: "t1",
  status: "draft",
  version: 1,
  currentVersion: 1,
  revision,
  submittedAt: null,
  prices,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("bid editor", () => {
  const calls: { body: { revision: number; prices: Record<string, number | null> } }[] = [];
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("loads the server's prices and autosaves what was typed, with the revision it saw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        calls.push({ body });
        return new Response(JSON.stringify({ bid: bid(body.revision + 1, { "01": 1000, ...body.prices }) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { result } = renderHook(() => useBidEditor("t1", bid(3, { "01": 1000 }), true), { wrapper });
    expect(result.current.inputs["01"]).toBe("10,00");
    act(() => result.current.change("02", "1.234,50"));
    expect(result.current.state).toBe("pending");
    await waitFor(() => expect(result.current.state).toBe("saved"), { timeout: 3000 });
    expect(calls).toEqual([{ body: { revision: 3, prices: { "02": 123450 } } }]);
    expect(result.current.revision).toBe(4);
    expect(result.current.dirty.size).toBe(0);
  });

  it("does not save what is not a number yet", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useBidEditor("t1", bid(0), true), { wrapper });
    act(() => result.current.change("01", "12,345"));
    expect(result.current.invalid.has("01")).toBe(true);
    await new Promise((r) => setTimeout(r, 900));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops and asks to reload when someone else saved in between", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "revision_conflict", message: "changed elsewhere" }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const { result, rerender } = renderHook(({ b }) => useBidEditor("t1", b, true), {
      wrapper,
      initialProps: { b: bid(5, { "01": 1000 }) },
    });
    act(() => result.current.change("01", "11,00"));
    await waitFor(() => expect(result.current.state).toBe("conflict"), { timeout: 3000 });
    rerender({ b: bid(7, { "01": 2000 }) }); // the other person's version, reloaded
    await waitFor(() => expect(result.current.inputs["01"]).toBe("20,00"));
    expect(result.current.state).toBe("idle");
  });
});

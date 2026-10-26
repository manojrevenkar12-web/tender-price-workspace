/**
 * The bid editor's state: what the bidder typed, what is saved, and what conflicts.
 *
 * Prices autosave a moment after typing stops. Each save carries the revision the editor last
 * saw; if someone else saved in between, the server answers 409 and the editor stops saving and
 * asks to reload, instead of overwriting their prices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../../shared/api/client";
import type { Bid } from "../../shared/api/types";
import { centsToInput, parseCentsInput } from "../../shared/lib/format";
import { layout } from "../../shared/theme/tokens";
import { useSaveBid } from "./api";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "conflict" | "error";

const toInputs = (bid: Bid | null) =>
  Object.fromEntries(Object.entries(bid?.prices ?? {}).map(([oz, c]) => [oz, centsToInput(c)]));

export function useBidEditor(tenderId: string, bid: Bid | null | undefined, enabled: boolean) {
  const save = useSaveBid(tenderId);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<number | null>(null);
  // The latest typed values, for deciding after a save which positions are still unsaved.
  const latest = useRef(inputs);
  const dirtyNow = useRef(dirty);
  useEffect(() => {
    latest.current = inputs;
    dirtyNow.current = dirty;
  }, [inputs, dirty]);

  // Take the server's prices when the bid first arrives, and again after a conflict once the
  // other person's version has been loaded (derived state, set during render on purpose).
  if (bid !== undefined) {
    const serverRevision = bid?.revision ?? 0;
    if (loaded === null || (state === "conflict" && serverRevision !== loaded)) {
      setInputs(toInputs(bid));
      setDirty(new Set());
      setRevision(serverRevision);
      setLoaded(serverRevision);
      if (state === "conflict") setState("idle");
    }
  }

  const invalid = useMemo(
    () =>
      new Set(
        Object.entries(inputs)
          .filter(([, v]) => parseCentsInput(v) === undefined)
          .map(([k]) => k),
      ),
    [inputs],
  );

  const flush = useCallback(async (): Promise<number> => {
    if (!enabled || dirty.size === 0 || state === "conflict") return revision;
    const prices: Record<string, number | null> = {};
    const sent: Record<string, string> = {};
    for (const oz of dirty) {
      sent[oz] = inputs[oz] ?? "";
      const v = parseCentsInput(inputs[oz] ?? "");
      if (v === undefined) continue; // not a number yet: keep it local
      prices[oz] = v;
    }
    if (Object.keys(prices).length === 0) return revision;
    setState("saving");
    try {
      const saved = await save.mutateAsync({ revision, prices });
      setRevision(saved.revision);
      setLoaded(saved.revision);
      setDirty((d) => {
        const n = new Set(d);
        // A position typed again while the save was in flight stays dirty.
        for (const oz of Object.keys(prices)) if ((latest.current[oz] ?? "") === sent[oz]) n.delete(oz);
        return n;
      });
      // The server drops prices for work that changed in an addendum: forget them here too.
      setInputs((i) => {
        const n = { ...i };
        for (const oz of Object.keys(n))
          if (!(oz in saved.prices) && !(oz in sent) && !dirtyNow.current.has(oz)) delete n[oz];
        return n;
      });
      setState("saved");
      setError(null);
      return saved.revision;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "revision_conflict") setState("conflict");
      else {
        setState("error");
        setError(e instanceof Error ? e.message : "Saving failed");
      }
      return revision;
    }
  }, [enabled, dirty, inputs, save, state, revision]);

  useEffect(() => {
    if (dirty.size === 0 || state === "conflict") return;
    const t = setTimeout(() => void flush(), layout.autosaveDelayMs);
    return () => clearTimeout(t);
  }, [dirty, inputs, flush, state]);

  const change = useCallback((oz: string, value: string) => {
    setInputs((i) => ({ ...i, [oz]: value }));
    setDirty((d) => new Set(d).add(oz));
    setState((s) => (s === "conflict" || s === "saving" ? s : "pending"));
  }, []);

  const prices = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [oz, v] of Object.entries(inputs)) {
      const c = parseCentsInput(v);
      if (typeof c === "number") out[oz] = c;
    }
    return out;
  }, [inputs]);

  return { inputs, prices, invalid, dirty, state, error, change, flush, revision };
}

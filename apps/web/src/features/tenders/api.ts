import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "../../shared/api/client";
import type {
  Activity,
  Change,
  Organization,
  Position,
  TenderDetail,
  TenderSummary,
} from "../../shared/api/types";
import { session } from "../../shared/lib/session";

export const keys = {
  tenders: ["tenders"] as const,
  tender: (id: string) => ["tender", id] as const,
  comparison: (id: string) => ["comparison", id] as const,
  activity: (id: string) => ["activity", id] as const,
  version: (id: string, v: number) => ["version", id, v] as const,
  diff: (id: string, from: number, to: number) => ["diff", id, from, to] as const,
};

export const useTenders = () =>
  useQuery({ queryKey: keys.tenders, queryFn: () => api.get<TenderSummary[]>("/api/tenders") });
export const useTender = (id: string) =>
  useQuery({ queryKey: keys.tender(id), queryFn: () => api.get<TenderDetail>(`/api/tenders/${id}`) });
export const useProjects = () =>
  useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ id: string; name: string; city: string; region: string }[]>("/api/projects"),
  });
export const useOrganizations = (trade?: string) =>
  useQuery({
    queryKey: ["organizations", trade ?? ""],
    queryFn: () =>
      api.get<Organization[]>(`/api/organizations${trade ? `?trade=${encodeURIComponent(trade)}` : ""}`),
  });
export const useVersion = (id: string, v: number, enabled = true) =>
  useQuery({
    queryKey: keys.version(id, v),
    queryFn: () => api.get<Position[]>(`/api/tenders/${id}/versions/${v}`),
    enabled,
  });
export const useDiff = (id: string, from: number, to: number, enabled = true) =>
  useQuery({
    queryKey: keys.diff(id, from, to),
    queryFn: () => api.get<Change[]>(`/api/tenders/${id}/diff?from=${from}&to=${to}`),
    enabled: enabled && from < to,
  });
export const useActivity = (id: string) =>
  useQuery({
    queryKey: keys.activity(id),
    queryFn: () => api.get<Activity[]>(`/api/tenders/${id}/activity`),
  });

function useInvalidateTender(id: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.tender(id) });
    void qc.invalidateQueries({ queryKey: keys.tenders });
    void qc.invalidateQueries({ queryKey: keys.comparison(id) });
    void qc.invalidateQueries({ queryKey: keys.activity(id) });
  };
}

export function usePublish(id: string) {
  const done = useInvalidateTender(id);
  return useMutation({
    mutationFn: (deadline: string) => api.post(`/api/tenders/${id}/publish`, { deadline }),
    onSuccess: done,
  });
}
export function useInvite(id: string) {
  const done = useInvalidateTender(id);
  return useMutation({
    mutationFn: (orgIds: string[]) =>
      api.post<{ invited: number }>(`/api/tenders/${id}/invitations`, { orgIds }),
    onSuccess: done,
  });
}
export function useClose(id: string) {
  const done = useInvalidateTender(id);
  return useMutation({ mutationFn: () => api.post(`/api/tenders/${id}/close`), onSuccess: done });
}
export function useAward(id: string) {
  const done = useInvalidateTender(id);
  return useMutation({
    mutationFn: (bidId: string) => api.post(`/api/tenders/${id}/award`, { bidId }),
    onSuccess: done,
  });
}
export function useAddendum(id: string) {
  const done = useInvalidateTender(id);
  return useMutation({
    mutationFn: (body: {
      note: string;
      positions: Omit<Position, "ordinal" | "unitCode" | "alternativeGroup">[];
    }) =>
      api.post<{ version: number; changes: Change[]; biddersAffected: number }>(
        `/api/tenders/${id}/addenda`,
        body,
      ),
    onSuccess: done,
  });
}
export function useCreateFromGaeb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      trade,
      title,
      xml,
    }: {
      projectId: string;
      trade: string;
      title?: string;
      xml: string;
    }) =>
      api.postXml<{ id: string; positions: number }>(
        `/api/tenders/gaeb?projectId=${projectId}&trade=${encodeURIComponent(trade)}${title ? `&title=${encodeURIComponent(title)}` : ""}`,
        xml,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.tenders }),
  });
}

/**
 * Live activity: server-sent events for this tender. New events are prepended to the activity
 * list and refresh what they change (a bid arriving refreshes the comparison).
 */
export function useLiveActivity(id: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const token = session.get()?.token;
    if (!token || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/tenders/${id}/events?token=${encodeURIComponent(token)}`);
    es.addEventListener("activity", (msg) => {
      const e = JSON.parse((msg as MessageEvent).data) as Activity;
      qc.setQueryData<Activity[]>(keys.activity(id), (old) =>
        old && !old.some((x) => x.id === e.id) ? [...old, e] : old,
      );
      if (
        ["bid_submitted", "bid_reopened", "addendum_published", "benchmarks_ready", "awarded"].includes(
          e.kind,
        )
      ) {
        void qc.invalidateQueries({ queryKey: keys.comparison(id) });
      }
      if (
        [
          "viewed",
          "declined",
          "bid_submitted",
          "bid_reopened",
          "invited",
          "awarded",
          "tender_closed",
          "addendum_published",
        ].includes(e.kind)
      ) {
        void qc.invalidateQueries({ queryKey: keys.tender(id) });
      }
    });
    return () => es.close();
  }, [id, qc]);
}

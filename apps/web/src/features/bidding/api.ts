import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../../shared/api/client";
import type { Bid } from "../../shared/api/types";
import { keys } from "../tenders/api";

export const bidKey = (id: string) => ["bid", id] as const;

export const useBid = (id: string) =>
  useQuery({
    queryKey: bidKey(id),
    queryFn: () => api.get<{ bid: Bid | null }>(`/api/tenders/${id}/bid`).then((r) => r.bid),
  });

export function useSaveBid(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { revision: number; prices: Record<string, number | null> }) =>
      api.put<{ bid: Bid }>(`/api/tenders/${id}/bid`, body).then((r) => r.bid),
    onSuccess: (bid) => qc.setQueryData(bidKey(id), bid),
  });
}

export function useSubmitBid(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (revision: number) =>
      api.post<{ bid: Bid }>(`/api/tenders/${id}/bid/submit`, { revision }).then((r) => r.bid),
    onSuccess: (bid) => {
      qc.setQueryData(bidKey(id), bid);
      void qc.invalidateQueries({ queryKey: keys.tenders });
    },
  });
}

export function useImportX84(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ xml, revision }: { xml: string; revision: number }) =>
      api.postXml<{ bid: Bid; ignored: string[] }>(`/api/tenders/${id}/bid/gaeb?revision=${revision}`, xml),
    onSuccess: (r) => qc.setQueryData(bidKey(id), r.bid),
  });
}

export function useDecline(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.post(`/api/tenders/${id}/decline`, { reason }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.tenders }),
  });
}

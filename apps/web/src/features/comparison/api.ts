import { useQuery } from "@tanstack/react-query";

import { api } from "../../shared/api/client";
import type { ComparisonView, Market, Position } from "../../shared/api/types";
import { keys } from "../tenders/api";

export const useComparison = (id: string) =>
  useQuery({
    queryKey: keys.comparison(id),
    queryFn: () => api.get<ComparisonView>(`/api/tenders/${id}/comparison`),
  });

export const useMarket = (id: string, oz: string | null) =>
  useQuery({
    queryKey: ["market", id, oz],
    queryFn: () =>
      api.get<Market & { position: Position; region: string; quarter: string }>(
        `/api/tenders/${id}/positions/${encodeURIComponent(oz!)}/market`,
      ),
    enabled: oz !== null,
  });

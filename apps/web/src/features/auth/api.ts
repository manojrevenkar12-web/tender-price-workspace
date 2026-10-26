import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "../../shared/api/client";
import type { User } from "../../shared/api/types";
import { session } from "../../shared/lib/session";

export interface DemoUser {
  email: string;
  name: string;
  org: string;
  kind: "contractor" | "subcontractor";
}

export const useDemoUsers = () =>
  useQuery({ queryKey: ["demo-users"], queryFn: () => api.get<DemoUser[]>("/api/demo-users"), retry: false });

export const useSignIn = () =>
  useMutation({
    // Demo users sign in by e-mail alone (only a demo deployment allows that); everyone else with a password.
    mutationFn: (c: { email: string; password?: string }) =>
      api.post<{ token: string; user: User }>("/api/session", c),
    onSuccess: (s) => session.set(s),
  });

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { LoginPage } from "../features/auth/LoginPage";
import { BidPage } from "../features/bidding/BidPage";
import { InvitationsPage } from "../features/bidding/InvitationsPage";
import { PriceCheckPage } from "../features/pricecheck/PriceCheckPage";
import { TenderListPage } from "../features/tenders/TenderListPage";
import { TenderPage } from "../features/tenders/TenderPage";
import { ApiError } from "../shared/api/client";
import { ToastProvider } from "../shared/ui";
import { Layout, RequireRole } from "./Layout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/tenders" replace /> },
      {
        path: "tenders",
        element: (
          <RequireRole role="contractor">
            <TenderListPage />
          </RequireRole>
        ),
      },
      {
        path: "tenders/:id",
        element: (
          <RequireRole role="contractor">
            <TenderPage />
          </RequireRole>
        ),
      },
      {
        path: "price-check",
        element: (
          <RequireRole role="contractor">
            <PriceCheckPage />
          </RequireRole>
        ),
      },
      {
        path: "bids",
        element: (
          <RequireRole role="subcontractor">
            <InvitationsPage />
          </RequireRole>
        ),
      },
      {
        path: "bids/:id",
        element: (
          <RequireRole role="subcontractor">
            <BidPage />
          </RequireRole>
        ),
      },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}

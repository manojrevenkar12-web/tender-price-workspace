import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { lazy, Suspense, type ReactNode } from "react";

import { LoginPage } from "../features/auth/LoginPage";
import { ApiError } from "../shared/api/client";
import { SkeletonRows, ToastProvider } from "../shared/ui";
import { Layout, RequireRole } from "./Layout";

// Each role loads only its own screens: a bidder never downloads the buyer's comparison grid.
const TenderListPage = lazy(() =>
  import("../features/tenders/TenderListPage").then((m) => ({ default: m.TenderListPage })),
);
const TenderPage = lazy(() =>
  import("../features/tenders/TenderPage").then((m) => ({ default: m.TenderPage })),
);
const PriceCheckPage = lazy(() =>
  import("../features/pricecheck/PriceCheckPage").then((m) => ({ default: m.PriceCheckPage })),
);
const InvitationsPage = lazy(() =>
  import("../features/bidding/InvitationsPage").then((m) => ({ default: m.InvitationsPage })),
);
const BidPage = lazy(() => import("../features/bidding/BidPage").then((m) => ({ default: m.BidPage })));

const screen = (role: "contractor" | "subcontractor", page: ReactNode) => (
  <RequireRole role={role}>
    <Suspense fallback={<SkeletonRows rows={8} label="Loading" />}>{page}</Suspense>
  </RequireRole>
);

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
      { path: "tenders", element: screen("contractor", <TenderListPage />) },
      { path: "tenders/:id", element: screen("contractor", <TenderPage />) },
      { path: "price-check", element: screen("contractor", <PriceCheckPage />) },
      { path: "bids", element: screen("subcontractor", <InvitationsPage />) },
      { path: "bids/:id", element: screen("subcontractor", <BidPage />) },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Animations follow the operating system's reduced-motion setting. */}
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </MotionConfig>
    </QueryClientProvider>
  );
}

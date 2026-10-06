import { createHashRouter, Navigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import DiffPage from "../pages/DiffPage";

export const router = createHashRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/diff" replace /> },
      { path: "diff", element: <DiffPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/diff" replace /> },
]);

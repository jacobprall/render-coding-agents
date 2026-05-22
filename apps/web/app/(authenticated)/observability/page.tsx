import type { Metadata } from "next";
import { ObservabilityDashboard } from "./dashboard";

export const metadata: Metadata = { title: "Observability" };

export default function ObservabilityPage() {
  return <ObservabilityDashboard />;
}

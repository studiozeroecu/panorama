import type { Metadata } from "next";
import CostosApp from "@/components/costos/CostosApp";

export const metadata: Metadata = {
  title: "Costos — Bear & Trend",
};

export const dynamic = "force-dynamic";

export default function CostosPage() {
  return <CostosApp />;
}

import type { Metadata } from "next";
import FinanzasApp from "@/components/finanzas/FinanzasApp";

export const metadata: Metadata = {
  title: "Finanzas — Bear & Trend",
};

export const dynamic = "force-dynamic";

export default function FinanzasPage() {
  return <FinanzasApp />;
}

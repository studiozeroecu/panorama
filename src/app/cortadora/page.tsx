import type { Metadata } from "next";
import CortadoraApp from "@/components/cortadora/CortadoraApp";

export const metadata: Metadata = {
  title: "Corte — Bear & Trend",
};

export const dynamic = "force-dynamic";

export default function CortadoraPage() {
  return <CortadoraApp />;
}

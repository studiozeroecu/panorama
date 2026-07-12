import type { Metadata } from "next";
import LogisticaApp from "@/components/logistica/LogisticaApp";

export const metadata: Metadata = {
  title: "Logística — Bear & Trend",
};

export const dynamic = "force-dynamic";

export default function LogisticaPage() {
  return <LogisticaApp />;
}

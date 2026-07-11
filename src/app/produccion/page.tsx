import type { Metadata } from "next";
import ProduccionApp from "@/components/produccion/ProduccionApp";

export const metadata: Metadata = {
  title: "Producción — Bear & Trend",
};

export const dynamic = "force-dynamic";

export default function ProduccionPage() {
  return <ProduccionApp />;
}

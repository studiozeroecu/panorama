import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSnapshot } from "@/lib/snapshots";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const desde = String(form.get("desde") ?? "");
  const hasta = String(form.get("hasta") ?? "");
  // mode: "check" (default) avisa si ya hay un snapshot del periodo;
  //       "replace" reemplaza los existentes; "keep" guarda aparte.
  const mode = String(form.get("mode") ?? "check") as "check" | "replace" | "keep";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo Excel." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return NextResponse.json(
      { error: "Indica el periodo que cubre el reporte (desde y hasta)." },
      { status: 400 }
    );
  }
  if (desde > hasta) {
    return NextResponse.json(
      { error: 'La fecha "desde" no puede ser posterior a "hasta".' },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await createSnapshot(supabase, {
    buffer,
    filename: file.name,
    desde,
    hasta,
    mode,
  });

  if (!result.ok) {
    if (result.conflict) {
      return NextResponse.json({ conflict: true, existing: result.existing }, { status: 409 });
    }
    return NextResponse.json(
      { error: result.error, warnings: result.warnings },
      { status: 400 }
    );
  }

  return NextResponse.json({ id: result.id, summary: result.summary, warnings: result.warnings });
}

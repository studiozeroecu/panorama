import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Zona a la que queda confinado cada rol. Un rol que NO esté aquí —hoy `admin`—
 * no tiene restricción y entra a todo.
 *
 * Antes esto era un booleano (`esLogistica ? … : …`), y con un tercer rol eso se
 * vuelve peligroso: todo lo que no fuera logística se trataba como admin, así que
 * la cortadora habría visto `/produccion` entera sin que nada fallara. Siendo un
 * mapa explícito, añadir un rol es añadir una línea, y **olvidarse de añadirla
 * deja al rol sin restricción** — por eso el check de `user_roles` en la base y
 * este mapa tienen que moverse juntos.
 *
 * Un usuario SIN fila en `user_roles` sigue cayendo aquí como `undefined`, es
 * decir sin zona: exactamente el comportamiento de antes, que el bootstrap de la
 * fase 6 asumía para las cuentas anteriores a los roles.
 */
const ZONA_DEL_ROL: Record<string, string | undefined> = {
  logistica: "/logistica",
  cortadora: "/cortadora",
};

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLogin = request.nextUrl.pathname.startsWith("/login");
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user) {
    const { data: rolRow } = await supabase
      .from("user_roles")
      .select("rol")
      .eq("user_id", user.id)
      .maybeSingle();

    const zona = ZONA_DEL_ROL[rolRow?.rol ?? ""];

    if (isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = zona ?? "/";
      return NextResponse.redirect(url);
    }
    if (zona && !request.nextUrl.pathname.startsWith(zona)) {
      const url = request.nextUrl.clone();
      url.pathname = zona;
      return NextResponse.redirect(url);
    }
  }
  return response;
}

export const config = {
  // api/telegram y api/cron tienen su propia autenticación (secreto de
  // webhook / CRON_SECRET) — no pasan por el login web.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/telegram|api/cron|.*\\.(?:svg|png|jpg|ico)$).*)",
  ],
};

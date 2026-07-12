import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
    // Fase 6: enrutamiento por rol. El rol "logistica" solo ve /logistica;
    // si la tabla de roles aún no existe (fases previas), se comporta como antes.
    const { data: rolRow } = await supabase
      .from("user_roles")
      .select("rol")
      .eq("user_id", user.id)
      .maybeSingle();
    const esLogistica = rolRow?.rol === "logistica";

    if (isLogin) {
      const url = request.nextUrl.clone();
      url.pathname = esLogistica ? "/logistica" : "/";
      return NextResponse.redirect(url);
    }
    if (esLogistica && !request.nextUrl.pathname.startsWith("/logistica")) {
      const url = request.nextUrl.clone();
      url.pathname = "/logistica";
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

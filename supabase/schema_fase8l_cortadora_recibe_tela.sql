-- Panorama — Bear & Trend · Fase 8l: la cortadora confirma la llegada de la tela
-- Ejecutar DESPUÉS de schema_fase8m_lock_pedido_cortadora.sql. Idempotente.
--
-- (Sí: la 8m se aplicó ANTES que la 8l. La 8m arregló un fallo en producción
-- mientras esta se escribía; el número no cambia el orden real.)
--
-- ⚠️ SIN begin;/commit; — ver la nota en schema_fase7_colores.sql.
--
-- ════════════════════════════════════════════════════════════
-- QUÉ HACE
--
-- Hasta ahora solo Mateo confirmaba la llegada de una tela (LlegadaTab): ponía
-- el ancho real y la fecha, y el pedido pasaba a 'entregado'. Ahora también la
-- cortadora, desde /cortadora, porque es ella quien la recibe y la mide.
--
-- POR QUÉ UNA FUNCIÓN Y NO UNA POLÍTICA DE UPDATE
--
-- RLS es de FILA, no de columna. Una política `for update` sobre
-- prod_pedidos_tela le dejaría cambiar, con su sesión y desde la API, el precio,
-- el proveedor, los colores o el total de metros — aunque la pantalla no se los
-- enseñe. Por eso la cortadora NO recibe ninguna política que le deje ESCRIBIR
-- en esta tabla, y la única puerta es fn_recibir_tela.
--
-- (Sí tiene una de UPDATE, "cortadora_bloquea_pedido" de la fase 8m, pero con
-- `with check (false)`: le deja BLOQUEAR la fila —lo exige el `for update` de
-- fn_registrar_corte— y rechaza cualquier modificación real. La verificación del
-- final acepta exactamente ese tipo de política y ninguna otra.)
--
--
--   · SECURITY DEFINER: corre con los permisos del dueño, así que no necesita
--     política de update. A cambio la guarda de rol de dentro deja de ser
--     cosmética: es la ÚNICA barrera. Por eso además se le quita el EXECUTE a
--     `anon` y a `public`.
--   · Recibe solo tres datos (pedido, ancho, fecha) y escribe solo cinco
--     columnas: estado, ancho_real, fecha_entrega_real, recibido_por_rol y
--     ancho_recibido. Nada más es alcanzable por este camino.
--
-- POR QUÉ DOS COLUMNAS Y NO UNA
--
--   recibido_por_rol  quién confirmó la llegada: 'admin' o 'cortadora'. null en
--                     los pedidos anteriores a esta fase (no se sabe y no se
--                     inventa). Un ROL y no un user_id: hay una sola cortadora,
--                     y lo que Mateo necesita saber es "la recibió ella", no un
--                     uuid que tendría que traducir.
--   ancho_recibido    FOTO del ancho que se midió al recibir. Mateo puede
--                     corregir ancho_real después; sin esta foto, el aviso
--                     "recibido por la cortadora · ancho X" le atribuiría a ella
--                     un número que puso él. Mismo patrón que
--                     prod_cortes.corrida_base frente a la del pedido.
--
-- IDEMPOTENCIA SIN idem_id
--
-- Aquí sí sirve una guarda por ESTADO (como `procesado` en la fase 7 o
-- `retornado` en la 8a), porque el registro ya existe: un pedido entregado no se
-- vuelve a recibir. Un doble toque, o dos personas a la vez, encuentran el
-- pedido ya entregado y reciben `{"ya_recibido": true, ...}` con lo que quedó
-- guardado — un AVISO, no un error rojo — y NO se modifica nada.
--
-- LOS TRIGGERS DE LA TABLA NO SE DISPARAN, y no por suerte:
--   · trg_proteger_pedido_con_cortes (8g) es `before update of colores, total_metros`
--   · trg_sync_pedido_colores (7/8c)     es `after insert or update of colores`
-- Un trigger por columnas solo dispara si la columna aparece en el SET, y este
-- update no nombra ninguna de las dos. La comprobación 7 del smoke test lo fija.
-- ════════════════════════════════════════════════════════════

-- ============================================================
-- 1) Las dos columnas nuevas
-- ============================================================

alter table prod_pedidos_tela add column if not exists recibido_por_rol text;
alter table prod_pedidos_tela add column if not exists ancho_recibido numeric(8,2);

alter table prod_pedidos_tela drop constraint if exists prod_pedidos_tela_recibido_por_rol_check;
alter table prod_pedidos_tela add constraint prod_pedidos_tela_recibido_por_rol_check
  check (recibido_por_rol is null or recibido_por_rol in ('admin', 'cortadora'));

comment on column prod_pedidos_tela.recibido_por_rol is
  'Quién confirmó la llegada (admin | cortadora). null = anterior a la fase 8l.';
comment on column prod_pedidos_tela.ancho_recibido is
  'FOTO del ancho (cm) medido al recibir. ancho_real puede corregirse después; este no.';

-- ============================================================
-- 2) fn_recibir_tela
--
--    Función NUEVA: no hay firmas viejas que borrar. Aun así, el bloque 4 de
--    abajo verifica que quede UNA sola — la lección de la fase 8k.
-- ============================================================

create or replace function fn_recibir_tela(
  p_pedido_id uuid,
  p_ancho_real numeric,
  p_fecha date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $BODY$
declare
  v_estado text;
  v_nombre text;
  v_rol    text;
  v_ped    prod_pedidos_tela%rowtype;
begin
  -- ⚠️ Con SECURITY DEFINER esta guarda es la ÚNICA barrera: RLS no aplica
  -- dentro. No quitarla ni relajarla "porque la pantalla ya filtra".
  if fn_es_admin() then
    v_rol := 'admin';
  elsif fn_es_cortadora() then
    v_rol := 'cortadora';
  else
    raise exception 'No tienes permiso para confirmar la llegada de telas.';
  end if;

  -- Lock de la fila: dos confirmaciones simultáneas se serializan aquí, y la
  -- segunda ve el estado que dejó la primera.
  select estado, nombre_tela into v_estado, v_nombre
  from prod_pedidos_tela
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'El pedido de tela no existe.';
  end if;

  -- ⚠️ IDEMPOTENCIA ANTES DE VALIDAR, igual que en fn_registrar_corte: un
  -- reintento no debe toparse con una validación que ya no aplica. Se devuelve
  -- lo que quedó guardado para que la pantalla lo muestre tal cual.
  if v_estado = 'entregado' then
    select * into v_ped from prod_pedidos_tela where id = p_pedido_id;
    return jsonb_build_object(
      'ya_recibido',        true,
      'nombre_tela',        v_ped.nombre_tela,
      'ancho_real',         v_ped.ancho_real,
      'fecha_entrega_real', v_ped.fecha_entrega_real,
      'recibido_por_rol',   v_ped.recibido_por_rol
    );
  end if;

  -- Aquí v_estado solo puede ser 'pendiente' o 'en_camino': el check de la
  -- columna no admite otro valor, así que no hay una tercera rama que validar.

  if p_fecha is null then
    raise exception 'La fecha de llegada es requerida.';
  end if;
  if p_fecha > fn_hoy_ecuador() then
    raise exception 'La fecha de llegada no puede ser futura.';
  end if;

  -- El ancho va SIEMPRE en centímetros. La base ya mezcla cm (150) y metros
  -- (1.05) en datos migrados; por debajo de 10 es casi seguro un error de unidad.
  -- Por arriba, 400 cm deja margen de sobra a cualquier tela real y atrapa un
  -- ancho tecleado en milímetros (1500).
  if p_ancho_real is null then
    raise exception 'Ingresa el ancho de la tela en centímetros.';
  end if;
  if p_ancho_real < 10 then
    raise exception 'El ancho debe ir en centímetros: % parece estar en metros (150 cm, no 1.5).',
      p_ancho_real;
  end if;
  if p_ancho_real > 400 then
    raise exception 'Un ancho de % cm no es razonable. ¿Está en milímetros?', p_ancho_real;
  end if;

  -- Solo estas cinco columnas. ⚠️ Ni `colores` ni `total_metros` en el SET: con
  -- cualquiera de las dos dispararían los triggers de las fases 7 y 8g.
  update prod_pedidos_tela
     set estado             = 'entregado',
         ancho_real         = round(p_ancho_real, 2),
         ancho_recibido     = round(p_ancho_real, 2),
         fecha_entrega_real = p_fecha,
         recibido_por_rol   = v_rol
   where id = p_pedido_id;

  return jsonb_build_object(
    'ya_recibido',      false,
    'nombre_tela',      v_nombre,
    'ancho_real',       round(p_ancho_real, 2),
    'recibido_por_rol', v_rol
  );
end $BODY$;

-- Supabase da EXECUTE a `anon` por defecto. La guarda de rol ya lo rechazaría
-- (sin sesión, auth.uid() es null), pero en una función SECURITY DEFINER no se
-- deja la puerta abierta para depender de una sola cerradura.
revoke all on function fn_recibir_tela(uuid, numeric, date) from public, anon;
grant execute on function fn_recibir_tela(uuid, numeric, date) to authenticated, service_role;

-- ============================================================
-- 3) Lo que puede LEER: también lo que viene en camino
--
--    La fase 8i la acotó a `estado = 'entregado'`. Ahora necesita ver lo que
--    está por llegar para poder recibirlo. Se amplía la lectura de los pedidos y
--    de sus colores (para saber qué colores y metros esperar).
--
--    Los cortes, maquilas y demás SIGUEN acotados a pedidos entregados — no
--    puede haber cortes de una tela que no llegó, así que ampliarlos no aporta.
--
--    ⚠️ Sigue sin ninguna política que le deje MODIFICAR prod_pedidos_tela (la
--    de la 8m solo bloquea: `with check (false)`). Eso es lo que obliga a pasar
--    por fn_recibir_tela.
-- ============================================================

drop policy if exists "cortadora_lee_pedidos" on prod_pedidos_tela;
create policy "cortadora_lee_pedidos" on prod_pedidos_tela
  for select to authenticated
  using (fn_es_cortadora());

drop policy if exists "cortadora_lee_pedido_colores" on prod_pedido_colores;
create policy "cortadora_lee_pedido_colores" on prod_pedido_colores
  for select to authenticated
  using (fn_es_cortadora());

-- ============================================================
-- 4) Verificación final — aborta si algo quedó mal
--
--    Lección de la 8k: si el resultado no se comprueba al final, un paso
--    saltado no se nota. Esto no cambia nada; solo mira.
-- ============================================================

do $VERIF8L$
declare
  v_n   int;
  v_txt text;
begin
  select count(*) into v_n from pg_proc where proname = 'fn_recibir_tela';
  if v_n <> 1 then
    raise exception 'Fase 8l: hay % versiones de fn_recibir_tela (debe haber 1).', v_n;
  end if;

  -- Toda política de escritura sobre prod_pedidos_tela tiene que ser de UNA de
  -- estas dos formas, y no se mira el nombre sino lo que hace:
  --   · la de admin (fase 6):  using y with check = fn_es_admin()
  --   · un candado sin escritura (fase 8m): UPDATE con `with check (false)`
  -- Cualquier otra —también una de cortadora con with check verdadero, o un
  -- UPDATE sin with check, que entonces reutiliza el using— aborta.
  select count(*), string_agg(policyname || ' [' || cmd || ']', ', ')
    into v_n, v_txt
  from pg_policies
  where tablename = 'prod_pedidos_tela'
    and cmd in ('UPDATE', 'ALL', 'INSERT', 'DELETE')
    and not (cmd = 'UPDATE' and with_check = 'false')
    and not (qual = 'fn_es_admin()' and with_check = 'fn_es_admin()');
  if v_n > 0 then
    raise exception 'Fase 8l: hay % política(s) de escritura no previstas sobre prod_pedidos_tela: %', v_n, v_txt;
  end if;

  select count(*) into v_n from information_schema.columns
  where table_name = 'prod_pedidos_tela'
    and column_name in ('recibido_por_rol', 'ancho_recibido');
  if v_n <> 2 then
    raise exception 'Fase 8l: faltan columnas nuevas (hay % de 2).', v_n;
  end if;

  raise notice 'Fase 8l aplicada: fn_recibir_tela única, sin escritura directa de la cortadora, 2 columnas.';
end $VERIF8L$;

-- ============================================================
-- DESHACER:
--   drop function if exists fn_recibir_tela(uuid, numeric, date);
--   alter table prod_pedidos_tela drop constraint if exists prod_pedidos_tela_recibido_por_rol_check;
--   alter table prod_pedidos_tela drop column if exists recibido_por_rol;
--   alter table prod_pedidos_tela drop column if exists ancho_recibido;
--   -- y restaurar las dos políticas de lectura con `estado = 'entregado'`
--   -- tal como están en schema_fase8i_rol_cortadora.sql.
-- ============================================================

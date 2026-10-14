-- Panorama — Bear & Trend · Resync de la fase 7
--
-- Rellena las filas normalizadas de los cortes y maquilas que se crearon con el
-- CÓDIGO VIEJO — el que inserta el `colores` jsonb directo, sin pasar por
-- fn_registrar_corte. Mientras la app en vivo no tenga el código de la fase 7,
-- cada corte nuevo nace así, y con el código nuevo se vería SIN colores.
--
-- ⚠️ Correr esto JUSTO ANTES de desplegar el código nuevo (y otra vez después, si
-- entre medias alguien siguió usando la app vieja). Es idempotente: solo toca los
-- padres que no tienen ninguna fila hija, así que no duplica nada.
--
-- ⚠️ SIN `begin;` / `commit;` — el SQL Editor de Supabase reparte las sentencias de
-- un script con transacción explícita entre conexiones del pool. Todo el trabajo va
-- en UN bloque DO, que es una sola sentencia y por tanto una sola transacción.
--
-- El jsonb es la fuente de verdad aquí: es lo que escribió el código viejo.

do $$
declare
  v_corte record;
  v_maq record;
  v_col jsonb;
  v_ord integer;
  v_cc_id uuid;
  v_tmp integer;
  v_cortes integer := 0;
  v_colores integer := 0;
  v_tallas integer := 0;
  v_maquilas integer := 0;
  v_maqcolores integer := 0;
  v_estados integer := 0;
  v_huerfanos integer := 0;
begin
  -- ── 1) cortes con jsonb pero sin filas normalizadas ──
  for v_corte in
    select k.id, k.pedido_id, k.colores
    from prod_cortes k
    where jsonb_array_length(k.colores) > 0
      and not exists (select 1 from prod_corte_colores cc where cc.corte_id = k.id)
  loop
    v_cortes := v_cortes + 1;

    for v_col, v_ord in
      select value, ord
      from jsonb_array_elements(v_corte.colores) with ordinality as c(value, ord)
    loop
      insert into prod_corte_colores
        (corte_id, pedido_color_id, color, unidades, metros_usados, orden)
      values (
        v_corte.id,
        -- se enlaza con el color de la tela por nombre normalizado; null si no hay
        (select pc.id from prod_pedido_colores pc
          where pc.pedido_id = v_corte.pedido_id
            and lower(btrim(pc.color)) = lower(btrim(v_col ->> 'color'))),
        btrim(v_col ->> 'color'),
        coalesce((v_col ->> 'unidades')::int, 0),
        (v_col ->> 'metros_usados')::numeric,
        v_ord)
      returning id into v_cc_id;
      v_colores := v_colores + 1;

      insert into prod_corte_color_tallas (corte_color_id, talla, unidades)
      select v_cc_id, t.key, t.value::int
      from jsonb_each_text(coalesce(v_col -> 'tallas', '{}'::jsonb)) as t(key, value)
      where t.value::int > 0;
      get diagnostics v_tmp = row_count;
      v_tallas := v_tallas + v_tmp;
    end loop;
  end loop;

  -- ── 2) maquilas con jsonb pero sin filas normalizadas ──
  --    El join va por nombre de color contra el corte; el índice único de
  --    prod_corte_colores garantiza que empareje una sola fila.
  --    El trigger trg_sync_maquila_colores reescribirá el jsonb con los mismos
  --    valores que acaba de leer: es un no-op, pero conviene saberlo.
  for v_maq in
    select m.id, m.corte_id, m.colores
    from prod_maquilas m
    where jsonb_array_length(m.colores) > 0
      and not exists (select 1 from prod_maquila_colores mc where mc.maquila_id = m.id)
  loop
    v_maquilas := v_maquilas + 1;

    insert into prod_maquila_colores
      (maquila_id, corte_color_id, estado, fecha_envio, fecha_entrega, procesado)
    select v_maq.id, cc.id,
           coalesce(c.value ->> 'estado', 'pendiente'),
           (c.value ->> 'fecha_envio')::date,
           (c.value ->> 'fecha_entrega')::date,
           coalesce((c.value ->> 'procesado')::boolean, false)
    from jsonb_array_elements(v_maq.colores) with ordinality as c(value, ord)
    join prod_corte_colores cc
      on cc.corte_id = v_maq.corte_id
     and lower(btrim(cc.color)) = lower(btrim(c.value ->> 'color'));
    get diagnostics v_tmp = row_count;
    v_maqcolores := v_maqcolores + v_tmp;

    -- si algún color de la maquila no encontró su color en el corte, se descartó
    -- en silencio: lo contamos para avisar.
    v_huerfanos := v_huerfanos + (jsonb_array_length(v_maq.colores) - v_tmp);
  end loop;

  -- ── 3) estados cambiados desde la app vieja ──
  --    MaquilaTab viejo reescribía el array jsonb entero, así que marcar un color
  --    como enviado/entregado NO llegaba a prod_maquila_colores. El paso 2 no lo
  --    arregla: su guarda salta las maquilas que ya tienen filas.
  --    Aquí el jsonb manda a propósito — es lo único que escribió el código viejo.
  --    Una vez desplegado el código nuevo esto queda en no-op, porque el trigger
  --    trg_sync_maquila_colores mantiene los dos lados iguales. Por eso conviene
  --    correrlo pegado al deploy y no semanas después.
  with jsonb_estado as (
    select m.id as maquila_id,
           lower(btrim(c.value ->> 'color')) as color_norm,
           c.value as val
    from prod_maquilas m
    cross join lateral jsonb_array_elements(m.colores) as c(value)
  )
  update prod_maquila_colores mc
     set estado        = coalesce(j.val ->> 'estado', mc.estado),
         fecha_envio   = (j.val ->> 'fecha_envio')::date,
         fecha_entrega = (j.val ->> 'fecha_entrega')::date,
         procesado     = coalesce((j.val ->> 'procesado')::boolean, mc.procesado)
    from jsonb_estado j, prod_corte_colores cc
   where cc.id = mc.corte_color_id
     and j.maquila_id = mc.maquila_id
     and j.color_norm = lower(btrim(cc.color))
     and (
          coalesce(j.val ->> 'estado', '') is distinct from coalesce(mc.estado, '')
       or (j.val ->> 'fecha_envio')::date is distinct from mc.fecha_envio
       or (j.val ->> 'fecha_entrega')::date is distinct from mc.fecha_entrega
       or coalesce((j.val ->> 'procesado')::boolean, false) is distinct from mc.procesado
     );
  get diagnostics v_tmp = row_count;
  v_estados := v_tmp;

  raise notice 'Resync fase 7: % corte(s) → % colores y % tallas · % maquila(s) → % colores · % estado(s) resincronizados.',
    v_cortes, v_colores, v_tallas, v_maquilas, v_maqcolores, v_estados;

  if v_huerfanos > 0 then
    raise warning 'OJO: % color(es) de maquila no emparejaron con su corte (mayúsculas/tildes distintas). Revísalos a mano.', v_huerfanos;
  end if;
end $$;

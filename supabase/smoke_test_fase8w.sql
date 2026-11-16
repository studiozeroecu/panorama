-- SMOKE TEST de la lista de estampados y renombrar (fase 8w).
-- NO forma parte de la cadena de migraciones. Requiere la 8w aplicada.
-- UN SOLO bloque DO que termina con un error a propósito: ese error ES el
-- reporte, y al lanzarlo PostgreSQL revierte todo.

do $SMOKE$
declare
  v_rep text := '';
  v_r   text;
  v_ok  int := 0;
  v_bad int := 0;
  v_a   uuid := gen_random_uuid();
  v_b   uuid := gen_random_uuid();
  v_c   uuid := gen_random_uuid();
  v_res jsonb;
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select true' $q$;

  insert into prod_lotes_estampado (id, prenda_nombre, color, tallas, total_unidades, disenos,
                                    costo_unitario, costo_total, estado)
  values (v_a, 'ZZ 8w', 'Negro', '{"S":3}'::jsonb, 3,
          '[{"nombre":"ZZcaja ","unidades":2,"tallas":{"S":2}},{"nombre":"ZZOso","unidades":1,"tallas":{"S":1}}]'::jsonb, 2.5, 7.5, 'pendiente'),
         (v_b, 'ZZ 8w', 'Blanco', '{"S":2}'::jsonb, 2,
          '[{"nombre":"zzcaja","unidades":2,"tallas":{"S":2}}]'::jsonb, 2.5, 5, 'pendiente'),
         (v_c, 'ZZ 8w', 'Gris', '{"S":1}'::jsonb, 1,
          '[{"nombre":"ZZcaja","unidades":1,"tallas":{"S":1}}]'::jsonb, 2.5, 2.5, 'retornado');

  -- ── 1. renombrar en los lotes de una producción ──
  begin
    v_res := fn_renombrar_estampado('zzCAJA', 'ZZCajas', array[v_a, v_b]);
    v_r := case
      when (v_res ->> 'lotes')::int = 2
       and (select disenos -> 0 ->> 'nombre' from prod_lotes_estampado where id = v_a) = 'ZZCajas'
       and (select disenos -> 1 ->> 'nombre' from prod_lotes_estampado where id = v_a) = 'ZZOso'
       and (select disenos -> 0 -> 'tallas' from prod_lotes_estampado where id = v_a) = '{"S":2}'::jsonb
       and (select disenos -> 0 ->> 'nombre' from prod_lotes_estampado where id = v_b) = 'ZZCajas'
       and (select disenos -> 0 ->> 'nombre' from prod_lotes_estampado where id = v_c) = 'ZZcaja'
       and exists (select 1 from prod_estampados where nombre = 'ZZCajas')
      then 'OK — 2 lotes, el retornado intacto, y "ZZCajas" en la lista'
      else 'FALLA — ' || coalesce(v_res::text, 'sin respuesta') end;
  exception when others then v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · renombrar ...................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. no deja juntar dos estampados de un mismo lote ──
  begin
    perform fn_renombrar_estampado('ZZOso', 'zzcajas', array[v_a]);
    v_r := 'FALLA — juntó dos estampados del mismo lote';
  exception when others then
    v_r := case when SQLERRM like '%ya tiene los dos%' then 'OK — rechazado'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · no junta en un lote ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. la lista no admite el mismo nombre con otras mayúsculas ──
  begin
    insert into prod_estampados (nombre) values (' zzcajas ');
    v_r := 'FALLA — aceptó un nombre repetido';
  exception when others then v_r := 'OK — "zzcajas" ya existe';
  end;
  v_rep := v_rep || E'\n  3 · lista sin repetidos ............ ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST lista de estampados (fase 8w) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;

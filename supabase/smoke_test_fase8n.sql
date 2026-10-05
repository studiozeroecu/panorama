-- SMOKE TEST: la cortadora crea maquiladoras (fase 8n).
-- NO forma parte de la cadena de migraciones.
-- Requiere que schema_fase8n_cortadora_crea_maquiladora.sql YA esté aplicado.
--
-- UN SOLO bloque DO. ⚠️ TERMINA SIEMPRE CON UN ERROR, A PROPÓSITO: ese "error"
-- ES el reporte, y al lanzarlo PostgreSQL revierte todo. No queda NADA.
--
-- Corre con RLS aplicando (`set local role authenticated`), como el de la 8m:
-- como `postgres` las políticas se saltan y no se probaría nada.
-- Sin asignaciones con la palabra clave de destino de PL/pgSQL (ver la 8l).

do $SMOKE$
declare
  v_rep  text := '';
  v_r    text;
  v_ok   int := 0;
  v_bad  int := 0;
  v_vieja uuid := gen_random_uuid();
begin
  execute $q$ create or replace function fn_es_admin() returns boolean
              language sql stable as 'select false' $q$;
  execute $q$ create or replace function fn_es_cortadora() returns boolean
              language sql stable as 'select true' $q$;

  -- montaje como postgres: una maquiladora que ya existía
  insert into prod_maquiladoras (id, nombre) values (v_vieja, 'ZZ_SMOKE 8n vieja');

  execute 'set local role authenticated';

  -- ── 1. puede crear una nueva ──
  begin
    insert into prod_maquiladoras (nombre) values ('ZZ_SMOKE 8n nueva');
    v_r := case when exists (select 1 from prod_maquiladoras where nombre = 'ZZ_SMOKE 8n nueva')
                then 'OK — creada y la ve'
                else 'FALLA — se insertó pero no la ve' end;
  exception when others then
    v_r := 'FALLA — ' || SQLERRM;
  end;
  v_rep := v_rep || E'\n  1 · crea una maquiladora ........... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 2. no puede crearla ya archivada ──
  begin
    insert into prod_maquiladoras (nombre, archivada_en) values ('ZZ_SMOKE 8n arch', now());
    v_r := 'FALLA — pudo crear una archivada';
  exception when others then
    v_r := case when SQLERRM ilike '%row-level security%' then 'OK — rechazada'
                else 'FALLA — otra razón: ' || SQLERRM end;
  end;
  v_rep := v_rep || E'\n  2 · no crea una archivada .......... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  -- ── 3. no puede renombrar ni archivar una existente ──
  --    Sin política de update la fila simplemente no se ve para escribir: 0 filas.
  begin
    update prod_maquiladoras set nombre = 'ZZ hackeada', archivada_en = now() where id = v_vieja;
  exception when others then null;
  end;
  -- ── 4. ni borrarla ──
  begin
    delete from prod_maquiladoras where id = v_vieja;
  exception when others then null;
  end;

  execute 'reset role';

  v_r := (select case when nombre = 'ZZ_SMOKE 8n vieja' and archivada_en is null
                      then 'OK — sigue igual' else 'FALLA — la modificó: ' || nombre end
          from prod_maquiladoras where id = v_vieja);
  v_rep := v_rep || E'\n  3 · no edita ni archiva ............ ' || coalesce(v_r, 'FALLA — la BORRÓ');
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  v_r := case when exists (select 1 from prod_maquiladoras where id = v_vieja)
              then 'OK — sigue ahí' else 'FALLA — la borró' end;
  v_rep := v_rep || E'\n  4 · no borra ....................... ' || v_r;
  if v_r like 'OK%' then v_ok := v_ok+1; else v_bad := v_bad+1; end if;

  raise exception E'\n════ SMOKE TEST cortadora crea maquiladora (fase 8n) ════%\n\n  RESULTADO: % OK · % fallidas  %\n\n  Este error es el reporte: todo lo que creó la prueba quedó revertido.\n',
    v_rep, v_ok, v_bad, case when v_bad = 0 then '✅' else '❌' end;
end $SMOKE$;

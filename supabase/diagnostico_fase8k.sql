-- Diagnóstico del estado real tras la fase 8k. SOLO LECTURA.
-- Una sola consulta: el editor de Supabase solo muestra el último resultado.

select * from (
  select 1 as orden,
         'versiones de fn_registrar_corte' as que,
         pg_get_function_identity_arguments(oid) as detalle
  from pg_proc where proname = 'fn_registrar_corte'

  union all
  select 2, 'columnas capas / corrida_base',
         table_name || '.' || column_name || '  (' || data_type || ', nullable=' || is_nullable || ')'
  from information_schema.columns
  where column_name in ('capas', 'corrida_base')
    and table_name in ('prod_cortes', 'prod_corte_colores', 'prod_pedidos_tela')

  union all
  select 3, 'cortes con capas a nivel de corte',
         count(*)::text || ' fila(s)'
  from prod_cortes
  where exists (select 1 from information_schema.columns
                where table_name = 'prod_cortes' and column_name = 'capas')

  union all
  select 4, 'colores de corte con capas puestas',
         count(*)::text || ' de ' || (select count(*)::text from prod_corte_colores) || ' fila(s)'
  from prod_corte_colores where capas is not null

  union all
  select 5, 'check de capas por color',
         coalesce((select conname from pg_constraint
                   where conrelid = 'prod_corte_colores'::regclass
                     and conname = 'prod_corte_colores_capas_positivo'), 'NO EXISTE')
) r order by orden, detalle;

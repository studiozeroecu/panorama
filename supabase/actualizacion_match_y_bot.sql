-- Panorama — Actualización: match por categorías + bot de logística
-- Ejecutar en el SQL Editor DESPUÉS de schema_fase6.sql.

-- 1) Reglas de exclusión en el match de costos
alter table costos_prendas add column if not exists match_excluir text[] not null default '{}';

-- 2) Reglas sembradas según la lógica del dueño ("HODDIE sin BASICA → estampada").
--    Nota: los reportes reales de VATEX escriben la básica como "COLOR ENTERO",
--    así que las reglas aceptan ambas palabras (alternativas con "|").
update costos_prendas set match_keywords = '{"HODDIE"}',                        match_excluir = '{"BASICA","COLOR ENTERO"}' where producto = 'hoddies';
update costos_prendas set match_keywords = '{"HODDIE","BASICA|COLOR ENTERO"}',  match_excluir = '{}'                        where producto = 'hoddie basica';
update costos_prendas set match_keywords = '{"CAMISETA"}',                      match_excluir = '{"BASICA","COLOR ENTERO"}' where producto = 'camiseta';
update costos_prendas set match_keywords = '{"CAMISETA","BASICA|COLOR ENTERO"}',match_excluir = '{}'                        where producto = 'camiseta basica';
update costos_prendas set match_keywords = '{"CUELLO CHINO"}',                  match_excluir = '{"BUZO"}'                  where producto = 'cuello chino';
update costos_prendas set match_keywords = '{"BUZO","CUELLO CHINO"}',           match_excluir = '{}'                        where producto = 'buzo cuello chino';
update costos_prendas set match_keywords = '{"PANT|PALAZZO"}',                  match_excluir = '{"CONJUNTO"}'              where producto = 'pant mujer';
update costos_prendas set match_keywords = '{"POLO"}',                          match_excluir = '{}'                        where producto = 'polo mujer';
update costos_prendas set match_keywords = '{"CONJUNTO"}',                      match_excluir = '{}'                        where producto = 'conjunto pantalon';
update costos_prendas set match_keywords = '{"BLUSA"}',                         match_excluir = '{}'                        where producto = 'bluza';
-- BLUZA y PANTALON (HANDEL) quedan sin reglas: se corrigen puntualmente o se
-- les define regla propia desde /costos cuando haya cómo distinguirlas.

-- 3) Bot de logística: chat de Telegram vinculado al usuario con rol
alter table user_roles add column if not exists telegram_chat_id text unique;
-- Registrar a la usuaria (después de que le escriba /start al bot y obtenga su id):
--   update user_roles set telegram_chat_id = '<chat_id>' where rol = 'logistica';

-- 4) Nuevo tipo de acción pendiente del bot: guías
alter table bot_pending_actions drop constraint if exists bot_pending_actions_kind_check;
alter table bot_pending_actions add constraint bot_pending_actions_kind_check
  check (kind in ('cheque', 'snapshot_conflict', 'guia'));

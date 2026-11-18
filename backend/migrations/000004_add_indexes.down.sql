-- 000002_add_indexes.down.sql
-- Eliminar índices (opcional, ya que borrar la tabla los elimina)

DROP INDEX IF EXISTS idx_equipment_name;
DROP INDEX IF EXISTS idx_equipment_monitoring;
DROP INDEX IF EXISTS idx_equipment_type;
DROP INDEX IF EXISTS idx_equipment_rack;
DROP INDEX IF EXISTS idx_check_results_equipment_checked;
-- Índices para optimización de consultas (Rendimiento y "до 3 вложений")

-- Historial: consultas frecuentes por equipo ordenadas por fecha descendente
CREATE INDEX idx_check_results_equipment_checked 
    ON check_results (equipment_id, checked_at DESC);

-- Filtros de equipamiento
CREATE INDEX idx_equipment_rack ON equipment (rack_id);
CREATE INDEX idx_equipment_type ON equipment (type);
CREATE INDEX idx_equipment_monitoring ON equipment (monitoring_enabled) WHERE monitoring_enabled = true;

-- NOTA: inventory_number ya tiene un índice implícito por el UNIQUE, 
-- pero si el equipo hace muchas búsquedas ILIKE sobre el nombre:
CREATE INDEX idx_equipment_name ON equipment (name);
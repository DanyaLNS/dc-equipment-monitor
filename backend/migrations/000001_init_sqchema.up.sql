-- Creación de las 4 tablas base del sistema

-- Si da error de extensión no encontrada, ejecutar:
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

--CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- 1. Tabla de usuarios
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Tabla de racks
CREATE TABLE racks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Tabla de equipamiento
CREATE TABLE equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    inventory_number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    address TEXT NOT NULL,
    tcp_port INT NOT NULL CHECK (tcp_port BETWEEN 1 AND 65535),
    rack_id UUID NOT NULL REFERENCES racks(id) ON DELETE RESTRICT,
    monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Tabla de resultados de chequeo
CREATE TABLE check_results (
    id BIGSERIAL PRIMARY KEY,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('available', 'unavailable')),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error_reason TEXT,
    address_snapshot TEXT NOT NULL,
    port_snapshot INT NOT NULL CHECK (port_snapshot BETWEEN 1 AND 65535)
);
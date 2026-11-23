-- dc-equipment-monitor schema v1

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    login TEXT NOT NULL,
    login_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN','OBSERVER')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    auth_version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rack (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT,
    description TEXT,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rack_name_uq ON rack (lower(name));

CREATE TABLE equipment (
    id BIGSERIAL PRIMARY KEY,
    rack_id BIGINT NOT NULL REFERENCES rack(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    inventory_number TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('SERVER','NETWORK','STORAGE','OTHER')),
    address TEXT NOT NULL,
    monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
    version BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX equipment_inventory_uq ON equipment (lower(inventory_number));
CREATE INDEX equipment_rack_idx ON equipment (rack_id);
CREATE INDEX equipment_type_idx ON equipment (type);

CREATE TABLE tcp_target (
    id BIGSERIAL PRIMARY KEY,
    equipment_id BIGINT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    tcp_port INT NOT NULL CHECK (tcp_port BETWEEN 1 AND 65535),
    label TEXT,
    monitoring_enabled BOOLEAN NOT NULL DEFAULT true,
    monitor_revision BIGINT NOT NULL DEFAULT 1,
    version BIGINT NOT NULL DEFAULT 1,
    next_due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (equipment_id, tcp_port)
);
CREATE INDEX tcp_target_due_idx ON tcp_target (next_due_at);

CREATE TABLE probe_result (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL UNIQUE,
    target_id BIGINT NOT NULL REFERENCES tcp_target(id) ON DELETE CASCADE,
    monitor_revision BIGINT NOT NULL,
    settings_version BIGINT NOT NULL,
    executor_epoch BIGINT NOT NULL,
    address_snapshot TEXT NOT NULL,
    port_snapshot INT NOT NULL,
    resolved_ip TEXT,
    status TEXT NOT NULL CHECK (status IN ('AVAILABLE','UNAVAILABLE')),
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL,
    duration_ms INT NOT NULL CHECK (duration_ms >= 0),
    error_code TEXT,
    error_text TEXT,
    CHECK (finished_at >= started_at),
    CHECK ((status='AVAILABLE' AND error_code IS NULL) OR (status='UNAVAILABLE' AND error_code IS NOT NULL))
);

CREATE INDEX probe_result_target_finished_idx ON probe_result (target_id, finished_at DESC, id DESC);

CREATE TABLE current_observation (
    target_id BIGINT PRIMARY KEY REFERENCES tcp_target(id) ON DELETE CASCADE,
    monitor_revision BIGINT NOT NULL,
    run_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('AVAILABLE','UNAVAILABLE')),
    checked_at TIMESTAMPTZ NOT NULL,
    duration_ms INT NOT NULL CHECK (duration_ms >= 0),
    resolved_ip TEXT,
    error_code TEXT,
    error_text TEXT
);

CREATE TABLE settings (
    id INT PRIMARY KEY DEFAULT 1,
    interval_seconds INT NOT NULL DEFAULT 60,
    timeout_ms INT NOT NULL DEFAULT 3000,
    concurrency INT NOT NULL DEFAULT 10,
    stale_after_seconds INT NOT NULL DEFAULT 120,
    retention_days INT NOT NULL DEFAULT 7,
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1);

CREATE TABLE runtime (
    id INT PRIMARY KEY DEFAULT 1,
    epoch BIGINT NOT NULL DEFAULT 0,
    owner_instance TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO runtime (id) VALUES (1);

CREATE TABLE session (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issued_auth_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ
);

CREATE TABLE limiter (
    kind TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    attempts TIMESTAMPTZ[] NOT NULL DEFAULT '{}',
    blocked_until TIMESTAMPTZ,
    PRIMARY KEY (kind, key_hash)
);

CREATE TABLE audit (
    id BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('USER','OPERATOR','ANONYMOUS')),
    actor_user_id BIGINT,
    actor_os TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id BIGINT,
    outcome TEXT NOT NULL CHECK (outcome IN ('OK','DENIED','ERROR')),
    request_id TEXT NOT NULL,
    details JSONB
);
CREATE INDEX audit_occurred_idx ON audit (occurred_at);

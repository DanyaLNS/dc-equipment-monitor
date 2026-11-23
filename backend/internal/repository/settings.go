package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SettingsRepo struct{ Pool *pgxpool.Pool }

func (r *SettingsRepo) Get(ctx context.Context) (map[string]any, int64, error) {
	var interval, timeout, conc, stale, retention int
	var ver int64
	var updated time.Time
	err := r.Pool.QueryRow(ctx, `SELECT interval_seconds, timeout_ms, concurrency, stale_after_seconds, retention_days, version, updated_at FROM settings WHERE id=1`).
		Scan(&interval, &timeout, &conc, &stale, &retention, &ver, &updated)
	if err != nil {
		return nil, 0, err
	}
	m := map[string]any{"interval_seconds": interval, "timeout_ms": timeout, "concurrency": conc, "stale_after_seconds": stale, "retention_days": retention, "version": ver, "updated_at": updated.UTC().Format(time.RFC3339)}
	return m, ver, nil
}

func (r *SettingsRepo) Update(ctx context.Context, fields map[string]any, ver int64) error {
	_, err := r.Pool.Exec(ctx, `UPDATE settings SET
		interval_seconds=COALESCE($1,interval_seconds),
		timeout_ms=COALESCE($2,timeout_ms),
		concurrency=COALESCE($3,concurrency),
		stale_after_seconds=COALESCE($4,stale_after_seconds),
		retention_days=COALESCE($5,retention_days),
		version=version+1, updated_at=now()
		WHERE id=1 AND version=$6`, fields["interval_seconds"], fields["timeout_ms"], fields["concurrency"], fields["stale_after_seconds"], fields["retention_days"], ver)
	return err
}

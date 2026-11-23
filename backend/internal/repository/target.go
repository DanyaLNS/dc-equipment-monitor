package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

type TargetRepo struct{ Pool *pgxpool.Pool }

func (r *TargetRepo) Create(ctx context.Context, equipID int64, port int, label *string, mon bool) (int64, error) {
	var id int64
	err := r.Pool.QueryRow(ctx, `INSERT INTO tcp_target (equipment_id, tcp_port, label, monitoring_enabled) VALUES ($1,$2,$3,$4) RETURNING id`,
		equipID, port, label, mon).Scan(&id)
	return id, err
}

func (r *TargetRepo) Get(ctx context.Context, id int64) (map[string]any, int64, error) {
	var equipID int64
	var port int
	var label *string
	var mon bool
	var rev, ver int64
	var created, updated string
	var nextDue *string
	err := r.Pool.QueryRow(ctx, `SELECT equipment_id, tcp_port, label, monitoring_enabled, monitor_revision, version, next_due_at, created_at, updated_at FROM tcp_target WHERE id=$1`, id).
		Scan(&equipID, &port, &label, &mon, &rev, &ver, &nextDue, &created, &updated)
	if err != nil {
		return nil, 0, err
	}
	m := map[string]any{"id": id, "equipment_id": equipID, "tcp_port": port, "label": label, "monitoring_enabled": mon, "monitor_revision": rev, "version": ver, "next_due_at": nextDue, "created_at": created, "updated_at": updated}
	return m, ver, nil
}

func (r *TargetRepo) ListByEquipment(ctx context.Context, equipID int64) ([]map[string]any, error) {
	rows, err := r.Pool.Query(ctx, `SELECT id, equipment_id, tcp_port, label, monitoring_enabled, monitor_revision, version, next_due_at, created_at, updated_at FROM tcp_target WHERE equipment_id=$1 ORDER BY tcp_port ASC, id ASC`, equipID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id, equip int64
		var port int
		var label *string
		var mon bool
		var rev, ver int64
		var nextDue *string
		var created, updated string
		if err := rows.Scan(&id, &equip, &port, &label, &mon, &rev, &ver, &nextDue, &created, &updated); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "equipment_id": equip, "tcp_port": port, "label": label, "monitoring_enabled": mon, "monitor_revision": rev, "version": ver, "next_due_at": nextDue, "created_at": created, "updated_at": updated, "effective_monitoring_enabled": mon, "state": "NOT_CHECKED", "last_result": nil, "stale_at": nil})
	}
	return items, nil
}

func (r *TargetRepo) Update(ctx context.Context, id int64, port *int, label *string, mon *bool, ver int64) error {
	_, err := r.Pool.Exec(ctx, `UPDATE tcp_target SET tcp_port=COALESCE($1,tcp_port), label=$2, monitoring_enabled=COALESCE($3,monitoring_enabled), version=version+1, updated_at=now() WHERE id=$4 AND version=$5`,
		port, label, mon, id, ver)
	return err
}

func (r *TargetRepo) Delete(ctx context.Context, id int64, ver int64) error {
	ct, err := r.Pool.Exec(ctx, `DELETE FROM tcp_target WHERE id=$1 AND version=$2`, id, ver)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("VERSION_CONFLICT")
	}
	return nil
}

package repository

import (
	"context"
	"fmt"
	"time"

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
	var created, updated time.Time
	var nextDue *time.Time
	err := r.Pool.QueryRow(ctx, `SELECT equipment_id, tcp_port, label, monitoring_enabled, monitor_revision, version, next_due_at, created_at, updated_at FROM tcp_target WHERE id=$1`, id).
		Scan(&equipID, &port, &label, &mon, &rev, &ver, &nextDue, &created, &updated)
	if err != nil {
		return nil, 0, err
	}
	var nextDueStr *string
	if nextDue != nil {
		s := nextDue.UTC().Format(time.RFC3339)
		nextDueStr = &s
	}
	m := map[string]any{"id": id, "equipment_id": equipID, "tcp_port": port, "label": label, "monitoring_enabled": mon, "monitor_revision": rev, "version": ver, "next_due_at": nextDueStr, "created_at": created.UTC().Format(time.RFC3339), "updated_at": updated.UTC().Format(time.RFC3339)}
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
		var nextDue *time.Time
		var created, updated time.Time
		if err := rows.Scan(&id, &equip, &port, &label, &mon, &rev, &ver, &nextDue, &created, &updated); err != nil {
			return nil, err
		}
		var nextDueStr *string
		if nextDue != nil {
			s := nextDue.UTC().Format(time.RFC3339)
			nextDueStr = &s
		}
		items = append(items, map[string]any{"id": id, "equipment_id": equip, "tcp_port": port, "label": label, "monitoring_enabled": mon, "monitor_revision": rev, "version": ver, "next_due_at": nextDueStr, "created_at": created.UTC().Format(time.RFC3339), "updated_at": updated.UTC().Format(time.RFC3339), "effective_monitoring_enabled": mon, "state": "NOT_CHECKED", "last_result": nil, "stale_at": nil})
	}
	return items, nil
}

func (r *TargetRepo) Update(ctx context.Context, id int64, port *int, label *string, mon *bool, ver int64) error {
	_, err := r.Pool.Exec(ctx, `UPDATE tcp_target SET tcp_port=COALESCE($1,tcp_port), label=$2, monitoring_enabled=COALESCE($3,monitoring_enabled), version=version+1, updated_at=now() WHERE id=$4 AND version=$5`,
		port, label, mon, id, ver)
	return err
}

func (r *TargetRepo) ListHistory(ctx context.Context, targetID int64) ([]map[string]any, error) {
	rows, err := r.Pool.Query(ctx, `SELECT id, run_id, target_id, monitor_revision, settings_version, address_snapshot, port_snapshot, resolved_ip, status, started_at, finished_at, duration_ms, error_code, error_text FROM probe_result WHERE target_id=$1 ORDER BY finished_at DESC, id DESC`, targetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id, target int64
		var runID string
		var monRev, settVer int64
		var addr string
		var port int
		var resolvedIP *string
		var status, started, finished string
		var dur int
		var errCode, errText *string
		if err := rows.Scan(&id, &runID, &target, &monRev, &settVer, &addr, &port, &resolvedIP, &status, &started, &finished, &dur, &errCode, &errText); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"id": id, "run_id": runID, "target_id": target, "monitor_revision": monRev, "settings_version": settVer, "address_snapshot": addr, "port_snapshot": port, "resolved_ip": resolvedIP, "status": status, "started_at": started, "finished_at": finished, "duration_ms": dur, "error_code": errCode, "error_text": errText})
	}
	return items, nil
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

package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type EquipmentRepo struct{ Pool *pgxpool.Pool }

func (r *EquipmentRepo) Create(ctx context.Context, rackID int64, name, inv, typ, addr string, mon bool) (int64, error) {
	var id int64
	err := r.Pool.QueryRow(ctx, `INSERT INTO equipment (rack_id, name, inventory_number, type, address, monitoring_enabled) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		rackID, name, inv, typ, addr, mon).Scan(&id)
	return id, err
}

func (r *EquipmentRepo) Get(ctx context.Context, id int64) (map[string]any, int64, error) {
	var rackID int64
	var name, inv, typ, addr string
	var mon bool
	var ver int64
	var created, updated time.Time
	err := r.Pool.QueryRow(ctx, `SELECT rack_id, name, inventory_number, type, address, monitoring_enabled, version, created_at, updated_at FROM equipment WHERE id=$1`, id).
		Scan(&rackID, &name, &inv, &typ, &addr, &mon, &ver, &created, &updated)
	if err != nil {
		return nil, 0, err
	}
	m := map[string]any{"id": id, "rack_id": rackID, "name": name, "inventory_number": inv, "type": typ, "address": addr, "monitoring_enabled": mon, "version": ver, "created_at": created.UTC().Format(time.RFC3339), "updated_at": updated.UTC().Format(time.RFC3339)}
	return m, ver, nil
}

func (r *EquipmentRepo) List(ctx context.Context, q string, rackID *int64, typ *string, mon *bool, page, size int) ([]map[string]any, int, error) {
	offset := (page - 1) * size
	rows, err := r.Pool.Query(ctx, `
		SELECT e.id, e.rack_id, r.name, e.name, e.inventory_number, e.type, e.address, e.monitoring_enabled, e.version, e.created_at, e.updated_at,
		       (SELECT count(*) FROM tcp_target t WHERE t.equipment_id=e.id) AS total,
		       (SELECT count(*) FROM tcp_target t JOIN current_observation c ON c.target_id=t.id WHERE t.equipment_id=e.id AND c.status='AVAILABLE') AS avail
		FROM equipment e JOIN rack r ON r.id=e.rack_id
		WHERE ($1='' OR lower(e.name) LIKE '%'||lower($1)||'%' OR lower(e.inventory_number) LIKE '%'||lower($1)||'%' OR lower(e.address) LIKE '%'||lower($1)||'%')
		  AND ($2::bigint IS NULL OR e.rack_id=$2)
		  AND ($3::text IS NULL OR e.type=$3)
		  AND ($4::boolean IS NULL OR e.monitoring_enabled=$4)
		ORDER BY e.id ASC LIMIT $5 OFFSET $6`, q, rackID, typ, mon, size, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id, rID int64
		var rName, name, inv, typv, addr string
		var monv bool
		var ver int64
		var created, updated time.Time
		var total, avail int
		if err := rows.Scan(&id, &rID, &rName, &name, &inv, &typv, &addr, &monv, &ver, &created, &updated, &total, &avail); err != nil {
			return nil, 0, err
		}
		items = append(items, map[string]any{
			"id": id, "rack_id": rID, "rack_name": rName, "name": name, "inventory_number": inv, "type": typv, "address": addr,
			"monitoring_enabled": monv, "version": ver, "created_at": created.UTC().Format(time.RFC3339), "updated_at": updated.UTC().Format(time.RFC3339),
			"target_counts": map[string]any{"total": total, "available": avail, "unavailable": 0, "not_checked": 0, "disabled": 0, "stale": 0},
		})
	}
	var total int
	r.Pool.QueryRow(ctx, `SELECT count(*) FROM equipment`).Scan(&total)
	return items, total, nil
}

func (r *EquipmentRepo) Update(ctx context.Context, id int64, fields map[string]any, ver int64) error {
	// simple: update name/inventory/type/address/rack/monitoring if present
	_, err := r.Pool.Exec(ctx, `UPDATE equipment SET
		name=COALESCE($1,name),
		inventory_number=COALESCE($2,inventory_number),
		type=COALESCE($3,type),
		address=COALESCE($4,address),
		rack_id=COALESCE($5,rack_id),
		monitoring_enabled=COALESCE($6,monitoring_enabled),
		version=version+1, updated_at=now()
		WHERE id=$7 AND version=$8`,
		fields["name"], fields["inventory_number"], fields["type"], fields["address"], fields["rack_id"], fields["monitoring_enabled"], id, ver)
	return err
}

func (r *EquipmentRepo) Delete(ctx context.Context, id int64, ver int64) error {
	ct, err := r.Pool.Exec(ctx, `DELETE FROM equipment WHERE id=$1 AND version=$2`, id, ver)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("VERSION_CONFLICT")
	}
	return nil
}

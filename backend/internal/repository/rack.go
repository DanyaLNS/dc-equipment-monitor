package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type RackRepo struct{ Pool *pgxpool.Pool }

func (r *RackRepo) Create(ctx context.Context, name string, loc, desc *string) (int64, error) {
	var id int64
	err := r.Pool.QueryRow(ctx, `INSERT INTO rack (name, location, description) VALUES ($1,$2,$3) RETURNING id`, name, loc, desc).Scan(&id)
	return id, err
}

func (r *RackRepo) Get(ctx context.Context, id int64) (map[string]any, int64, error) {
	var name string
	var loc, desc *string
	var ver int64
	var created, updated time.Time
	err := r.Pool.QueryRow(ctx, `SELECT name, location, description, version, created_at, updated_at FROM rack WHERE id=$1`, id).
		Scan(&name, &loc, &desc, &ver, &created, &updated)
	if err != nil {
		return nil, 0, err
	}
	m := map[string]any{"id": id, "name": name, "location": loc, "description": desc, "version": ver, "created_at": created.UTC().Format(time.RFC3339), "updated_at": updated.UTC().Format(time.RFC3339)}
	return m, ver, nil
}

func (r *RackRepo) List(ctx context.Context, q string, page, size int) ([]map[string]any, int, error) {
	offset := (page - 1) * size
	rows, err := r.Pool.Query(ctx, `
		SELECT r.id, r.name, r.location, r.description, r.version, r.created_at, r.updated_at,
		       (SELECT count(*) FROM equipment e WHERE e.rack_id=r.id) AS ec
		FROM rack r
		WHERE ($1='' OR lower(r.name) LIKE '%'||lower($1)||'%' OR lower(COALESCE(r.location,'')) LIKE '%'||lower($1)||'%')
		ORDER BY r.id ASC LIMIT $2 OFFSET $3`, q, size, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []map[string]any
	for rows.Next() {
		var id int64
		var name string
		var loc, desc *string
		var ver int64
		var created, updated time.Time
		var ec int
		if err := rows.Scan(&id, &name, &loc, &desc, &ver, &created, &updated, &ec); err != nil {
			return nil, 0, err
		}
		items = append(items, map[string]any{"id": id, "name": name, "location": loc, "description": desc, "version": ver, "created_at": created.UTC().Format(time.RFC3339), "updated_at": updated.UTC().Format(time.RFC3339), "equipment_count": ec})
	}
	var total int
	r.Pool.QueryRow(ctx, `SELECT count(*) FROM rack WHERE ($1='' OR lower(name) LIKE '%'||lower($1)||'%' OR lower(COALESCE(location,'')) LIKE '%'||lower($1)||'%')`, q).Scan(&total)
	return items, total, nil
}

func (r *RackRepo) Update(ctx context.Context, id int64, name *string, loc, desc *string, ver int64) (int64, error) {
	// build dynamic not needed; update provided
	_, err := r.Pool.Exec(ctx, `UPDATE rack SET name=COALESCE($1,name), location=$2, description=$3, version=version+1, updated_at=now() WHERE id=$4 AND version=$5`, name, loc, desc, id, ver)
	if err != nil {
		return 0, err
	}
	return ver + 1, nil
}

func (r *RackRepo) Delete(ctx context.Context, id int64, ver int64) error {
	// check empty
	var cnt int
	r.Pool.QueryRow(ctx, `SELECT count(*) FROM equipment WHERE rack_id=$1`, id).Scan(&cnt)
	if cnt > 0 {
		return fmt.Errorf("RACK_NOT_EMPTY")
	}
	ct, err := r.Pool.Exec(ctx, `DELETE FROM rack WHERE id=$1 AND version=$2`, id, ver)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("VERSION_CONFLICT")
	}
	return nil
}

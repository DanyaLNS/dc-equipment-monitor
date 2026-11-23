package repository

import (
	"context"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/auth"
)

type UserRepo struct{ Pool *pgxpool.Pool }

func NormalizeLogin(login string) string {
	// NFC + casefold-ish: lowercase + trim
	s := strings.TrimSpace(login)
	// simple casefold
	r := []rune(s)
	for i := range r {
		r[i] = unicode.ToLower(r[i])
	}
	return string(r)
}

func (r *UserRepo) Create(ctx context.Context, login, password, role string) (int64, error) {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return 0, err
	}
	key := NormalizeLogin(login)
	var id int64
	err = r.Pool.QueryRow(ctx, `INSERT INTO users (login, login_key, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
		login, key, hash, role).Scan(&id)
	return id, err
}

func (r *UserRepo) GetByLogin(ctx context.Context, login string) (int64, string, string, bool, int64, error) {
	key := NormalizeLogin(login)
	var id int64
	var hash, role string
	var active bool
	var av int64
	err := r.Pool.QueryRow(ctx, `SELECT id, password_hash, role, is_active, auth_version FROM users WHERE login_key=$1`, key).
		Scan(&id, &hash, &role, &active, &av)
	return id, hash, role, active, av, err
}

func (r *UserRepo) GetByID(ctx context.Context, id int64) (string, string, bool, int64, error) {
	var login, role string
	var active bool
	var av int64
	err := r.Pool.QueryRow(ctx, `SELECT login, role, is_active, auth_version FROM users WHERE id=$1`, id).
		Scan(&login, &role, &active, &av)
	return login, role, active, av, err
}

func (r *UserRepo) UpdatePassword(ctx context.Context, id int64, password string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	_, err = r.Pool.Exec(ctx, `UPDATE users SET password_hash=$1, auth_version=auth_version+1, updated_at=now() WHERE id=$2`, hash, id)
	return err
}

func (r *UserRepo) UpdateRole(ctx context.Context, id int64, role string) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET role=$1, auth_version=auth_version+1, updated_at=now() WHERE id=$2`, role, id)
	return err
}

func (r *UserRepo) SetActive(ctx context.Context, id int64, active bool) error {
	_, err := r.Pool.Exec(ctx, `UPDATE users SET is_active=$1, auth_version=auth_version+1, updated_at=now() WHERE id=$2`, active, id)
	return err
}

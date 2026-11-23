package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/auth"
)

type SessionRepo struct{ Pool *pgxpool.Pool }

func (r *SessionRepo) Create(ctx context.Context, userID int64, authVersion int64) (string, error) {
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		return "", err
	}
	_, err = r.Pool.Exec(ctx, `INSERT INTO session (token_hash, user_id, issued_auth_version) VALUES ($1,$2,$3)`, hash, userID, authVersion)
	if err != nil {
		return "", err
	}
	return token, nil
}

func (r *SessionRepo) Get(ctx context.Context, token string) (int64, int64, time.Time, *time.Time, error) {
	hash := auth.HashToken(token)
	var userID, av int64
	var lastAct time.Time
	var revoked *time.Time
	err := r.Pool.QueryRow(ctx, `SELECT user_id, issued_auth_version, last_activity_at, revoked_at FROM session WHERE token_hash=$1`, hash).
		Scan(&userID, &av, &lastAct, &revoked)
	return userID, av, lastAct, revoked, err
}

func (r *SessionRepo) Touch(ctx context.Context, token string) error {
	hash := auth.HashToken(token)
	_, err := r.Pool.Exec(ctx, `UPDATE session SET last_activity_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`, hash)
	return err
}

func (r *SessionRepo) Revoke(ctx context.Context, token string) error {
	hash := auth.HashToken(token)
	_, err := r.Pool.Exec(ctx, `UPDATE session SET revoked_at=now() WHERE token_hash=$1`, hash)
	return err
}

func (r *SessionRepo) RevokeAllForUser(ctx context.Context, userID int64) error {
	_, err := r.Pool.Exec(ctx, `UPDATE session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, userID)
	return err
}

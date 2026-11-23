package repository

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type LimiterRepo struct{ Pool *pgxpool.Pool }

func (r *LimiterRepo) CheckAndRecord(ctx context.Context, kind, key string) (bool, time.Duration, error) {
	// simple: count attempts in last 15 min; if >=5 block 15min
	var blocked *time.Time
	var attempts []time.Time
	err := r.Pool.QueryRow(ctx, `SELECT blocked_until, attempts FROM limiter WHERE kind=$1 AND key_hash=$2`, kind, key).Scan(&blocked, &attempts)
	if err != nil {
		// no record
		_, _ = r.Pool.Exec(ctx, `INSERT INTO limiter (kind, key_hash, attempts) VALUES ($1,$2,$3)`, kind, key, []time.Time{time.Now()})
		return true, 0, nil
	}
	if blocked != nil && time.Now().Before(*blocked) {
		return false, time.Until(*blocked), nil
	}
	// count recent
	cutoff := time.Now().Add(-15 * time.Minute)
	n := 0
	for _, a := range attempts {
		if a.After(cutoff) {
			n++
		}
	}
	if n >= 5 {
		bu := time.Now().Add(15 * time.Minute)
		_, _ = r.Pool.Exec(ctx, `UPDATE limiter SET blocked_until=$1 WHERE kind=$2 AND key_hash=$3`, bu, kind, key)
		return false, 15 * time.Minute, nil
	}
	attempts = append(attempts, time.Now())
	_, _ = r.Pool.Exec(ctx, `UPDATE limiter SET attempts=$1 WHERE kind=$2 AND key_hash=$3`, attempts, kind, key)
	return true, 0, nil
}

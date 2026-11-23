package repository

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AuditRepo struct{ Pool *pgxpool.Pool }

func (r *AuditRepo) Log(ctx context.Context, actorKind string, userID *int64, role *string, action, targetType string, targetID *int64, outcome, requestID string, details map[string]any) {
	d, _ := json.Marshal(details)
	_, _ = r.Pool.Exec(ctx, `INSERT INTO audit (actor_kind, actor_user_id, actor_role, action, target_type, target_id, outcome, request_id, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		actorKind, userID, role, action, targetType, targetID, outcome, requestID, d)
}

package ops

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func StartCleanup(ctx context.Context, pool *pgxpool.Pool) {
	ticker := time.NewTicker(15 * time.Minute)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				pool.Exec(ctx, `DELETE FROM probe_result WHERE finished_at < now() - interval '7 days'`)
				pool.Exec(ctx, `DELETE FROM audit WHERE occurred_at < now() - interval '30 days'`)
				log.Println("cleanup done")
			}
		}
	}()
}

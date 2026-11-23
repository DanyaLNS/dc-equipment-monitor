package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/handler"
	"dc-equipment-monitor/backend/internal/repository"
)

type AuthMW struct {
	Pool     *pgxpool.Pool
	Users    *repository.UserRepo
	Sessions *repository.SessionRepo
}

func (m *AuthMW) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("session")
		if err != nil {
			handler.WriteErr(w, r, 401, "UNAUTHENTICATED", "unauthenticated")
			return
		}
		uid, av, lastAct, revoked, err := m.Sessions.Get(r.Context(), c.Value)
		if err != nil {
			handler.WriteErr(w, r, 401, "UNAUTHENTICATED", "unauthenticated")
			return
		}
		if revoked != nil {
			handler.WriteErr(w, r, 401, "UNAUTHENTICATED", "unauthenticated")
			return
		}
		// absolute session expiry: 8h30m from last activity? spec: 8h30 from last allowed request; polling extends idle not absolute
		if time.Since(lastAct) > 8*time.Hour+30*time.Minute {
			handler.WriteErr(w, r, 401, "UNAUTHENTICATED", "unauthenticated")
			return
		}
		login, role, active, curAV, err := m.Users.GetByID(r.Context(), uid)
		_ = login
		if err != nil || !active || curAV != av {
			handler.WriteErr(w, r, 401, "UNAUTHENTICATED", "unauthenticated")
			return
		}
		_ = role
		ctx := context.WithValue(r.Context(), handler.CtxUserID, uid)
		ctx = context.WithValue(ctx, handler.CtxRole, role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func WriteErr(w http.ResponseWriter, r *http.Request, status int, code, msg string) {
	handler.WriteErr(w, r, status, code, msg)
}

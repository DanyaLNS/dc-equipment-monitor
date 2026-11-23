package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/auth"
	"dc-equipment-monitor/backend/internal/repository"
)

type AuthHandler struct {
	Pool    *pgxpool.Pool
	Users   *repository.UserRepo
	Sessions *repository.SessionRepo
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteErr(w, r, 400, "INVALID_JSON", "invalid json")
		return
	}
	id, hash, role, active, av, err := h.Users.GetByLogin(r.Context(), body.Login)
	if err != nil || !active || !auth.VerifyPassword(body.Password, hash) {
		WriteErr(w, r, 401, "INVALID_CREDENTIALS", "invalid credentials")
		return
	}
	token, err := h.Sessions.Create(r.Context(), id, av)
	if err != nil {
		WriteErr(w, r, 500, "INTERNAL_ERROR", "internal error")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   false,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(8*time.Hour + 30*time.Minute),
	})
	csrf := "csrf-" + token[:16]
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]any{
			"user":              map[string]any{"id": id, "login": body.Login, "role": role},
			"csrf_token":        csrf,
			"session_expires_at": time.Now().Add(8*time.Hour + 30*time.Minute).UTC().Format(time.RFC3339),
		},
		"meta": map[string]any{"server_time": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value(CtxUserID).(int64)
	login, role, active, av, err := h.Users.GetByID(r.Context(), uid)
	if err != nil || !active {
		WriteErr(w, r, 401, "UNAUTHENTICATED", "unauthenticated")
		return
	}
	_ = av
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]any{
			"user":              map[string]any{"id": uid, "login": login, "role": role},
			"csrf_token":        "csrf",
			"session_expires_at": time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
		},
		"meta": map[string]any{"server_time": time.Now().UTC().Format(time.RFC3339)},
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("session")
	if err == nil {
		h.Sessions.Revoke(r.Context(), c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "session", Value: "", Path: "/", MaxAge: -1})
	w.WriteHeader(204)
}

type CtxKey string

var CtxUserID CtxKey = "uid"
var CtxRole CtxKey = "role"

func WriteErr(w http.ResponseWriter, r *http.Request, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{"code": code, "message": msg, "fields": map[string]any{}, "request_id": r.Header.Get("X-Request-ID")},
		"meta":  map[string]any{"server_time": time.Now().UTC().Format(time.RFC3339)},
	})
}

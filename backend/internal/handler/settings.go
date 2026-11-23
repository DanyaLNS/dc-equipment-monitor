package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/repository"
)

type SettingsHandler struct {
	Pool *pgxpool.Pool
	Repo *repository.SettingsRepo
}

func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	m, ver, err := h.Repo.Get(r.Context())
	if err != nil {
		WriteErr(w, r, 500, "INTERNAL_ERROR", "internal")
		return
	}
	w.Header().Set("ETag", "\"settings-v"+strconv.FormatInt(ver, 10)+"\"")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": m, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("If-Match") == "" {
		WriteErr(w, r, 428, "PRECONDITION_REQUIRED", "if-match required")
		return
	}
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	// validation ranges (basic)
	if v, ok := body["interval_seconds"].(float64); ok {
		if v < 10 || v > 3600 {
			WriteErr(w, r, 422, "VALIDATION_ERROR", "invalid interval")
			return
		}
	}
	_, ver, _ := h.Repo.Get(r.Context())
	err := h.Repo.Update(r.Context(), body, ver)
	if err != nil {
		WriteErr(w, r, 412, "VERSION_CONFLICT", "conflict")
		return
	}
	w.WriteHeader(200)
	json.NewEncoder(w).Encode(map[string]any{"data": body, "meta": map[string]any{"server_time": timeNow()}})
}

type SummaryHandler struct {
	Pool    *pgxpool.Pool
	mu      sync.Mutex
	cache   map[string]any
	cacheAt time.Time
}

func (h *SummaryHandler) Get(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cache != nil && time.Since(h.cacheAt) < 2*time.Second {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(h.cache)
		return
	}
	var racks, equip, targets int
	h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM rack`).Scan(&racks)
	h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM equipment`).Scan(&equip)
	h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM tcp_target`).Scan(&targets)
	now := timeNow()
	resp := map[string]any{
		"data": map[string]any{"racks_total": racks, "equipment_total": equip, "targets": map[string]any{"total": targets, "available": 0, "unavailable": 0, "not_checked": targets, "disabled": 0, "stale": 0}},
		"meta": map[string]any{"server_time": now, "computed_at": now},
	}
	h.cache = resp
	h.cacheAt = time.Now()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

type ClientEventsHandler struct{}

func (h *ClientEventsHandler) Post(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(204)
}

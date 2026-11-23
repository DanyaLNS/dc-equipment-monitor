package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

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
	w.Header().Set("ETag", "\"settings-v"+strconv.FormatInt(ver,10)+"\"")
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
	Pool *pgxpool.Pool
}

func (h *SummaryHandler) Get(w http.ResponseWriter, r *http.Request) {
	var racks, equip, targets int
	h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM rack`).Scan(&racks)
	h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM equipment`).Scan(&equip)
	h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM tcp_target`).Scan(&targets)
	w.Header().Set("Content-Type", "application/json")
	now := timeNow()
	json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]any{"racks_total": racks, "equipment_total": equip, "targets": map[string]any{"total": targets, "available": 0, "unavailable": 0, "not_checked": targets, "disabled": 0, "stale": 0}},
		"meta": map[string]any{"server_time": now, "computed_at": now},
	})
}

type ClientEventsHandler struct{}

func (h *ClientEventsHandler) Post(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(204)
}

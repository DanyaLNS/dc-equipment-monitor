package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/repository"
)

type EquipmentHandler struct {
	Pool *pgxpool.Pool
	Repo *repository.EquipmentRepo
	Targets *repository.TargetRepo
}

func (h *EquipmentHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	page := atoi(r.URL.Query().Get("page"), 1)
	size := atoi(r.URL.Query().Get("page_size"), 20)
	items, total, err := h.Repo.List(r.Context(), q, nil, nil, nil, page, size)
	if err != nil {
		WriteErr(w, r, 500, "INTERNAL_ERROR", "internal")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"items": items}, "meta": map[string]any{"server_time": timeNow(), "page": page, "page_size": size, "total": total}})
}

func (h *EquipmentHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RackID            int64  `json:"rack_id"`
		Name              string `json:"name"`
		InventoryNumber   string `json:"inventory_number"`
		Type              string `json:"type"`
		Address           string `json:"address"`
		MonitoringEnabled *bool  `json:"monitoring_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteErr(w, r, 400, "INVALID_JSON", "invalid")
		return
	}
	mon := true
	if body.MonitoringEnabled != nil {
		mon = *body.MonitoringEnabled
	}
	id, err := h.Repo.Create(r.Context(), body.RackID, body.Name, body.InventoryNumber, body.Type, body.Address, mon)
	if err != nil {
		WriteErr(w, r, 500, "INTERNAL_ERROR", "internal")
		return
	}
	w.Header().Set("ETag", "\"equipment-"+strconv.FormatInt(id,10)+"-v1\"")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": id}, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *EquipmentHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	m, ver, err := h.Repo.Get(r.Context(), id)
	if err != nil {
		WriteErr(w, r, 404, "NOT_FOUND", "not found")
		return
	}
	w.Header().Set("ETag", "\"equipment-"+strconv.FormatInt(id,10)+"-v"+strconv.FormatInt(ver,10)+"\"")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": m, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *EquipmentHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if r.Header.Get("If-Match") == "" {
		WriteErr(w, r, 428, "PRECONDITION_REQUIRED", "if-match required")
		return
	}
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	fields := map[string]any{}
	for k, v := range body {
		fields[k] = v
	}
	err := h.Repo.Update(r.Context(), id, fields, 1)
	if err != nil {
		WriteErr(w, r, 412, "VERSION_CONFLICT", "conflict")
		return
	}
	w.WriteHeader(200)
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": id}, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *EquipmentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if r.Header.Get("If-Match") == "" {
		WriteErr(w, r, 428, "PRECONDITION_REQUIRED", "if-match required")
		return
	}
	err := h.Repo.Delete(r.Context(), id, 1)
	if err != nil {
		WriteErr(w, r, 412, "VERSION_CONFLICT", "conflict")
		return
	}
	w.WriteHeader(204)
}

func (h *EquipmentHandler) View(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	m, _, err := h.Repo.Get(r.Context(), id)
	if err != nil {
		WriteErr(w, r, 404, "NOT_FOUND", "not found")
		return
	}
	targets, _ := h.Targets.ListByEquipment(r.Context(), id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]any{
			"equipment": m,
			"rack":      map[string]any{"id": m["rack_id"], "name": m["rack_name"]},
			"target_counts": map[string]any{"total": len(targets), "available": 0, "unavailable": 0, "not_checked": len(targets), "disabled": 0, "stale": 0},
			"targets":   targets,
		},
		"meta": map[string]any{"server_time": timeNow(), "page": 1, "page_size": 20, "total": len(targets)},
	})
}

type TargetHandler struct {
	Pool *pgxpool.Pool
	Repo *repository.TargetRepo
}

func (h *TargetHandler) Create(w http.ResponseWriter, r *http.Request) {
	equipID, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var body struct {
		TcpPort           int     `json:"tcp_port"`
		Label             *string `json:"label"`
		MonitoringEnabled *bool   `json:"monitoring_enabled"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	mon := true
	if body.MonitoringEnabled != nil {
		mon = *body.MonitoringEnabled
	}
	id, err := h.Repo.Create(r.Context(), equipID, body.TcpPort, body.Label, mon)
	if err != nil {
		WriteErr(w, r, 500, "INTERNAL_ERROR", "internal")
		return
	}
	w.Header().Set("ETag", "\"target-"+strconv.FormatInt(id,10)+"-v1\"")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": id}, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *TargetHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	m, ver, err := h.Repo.Get(r.Context(), id)
	if err != nil {
		WriteErr(w, r, 404, "NOT_FOUND", "not found")
		return
	}
	w.Header().Set("ETag", "\"target-"+strconv.FormatInt(id,10)+"-v"+strconv.FormatInt(ver,10)+"\"")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": m, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *TargetHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if r.Header.Get("If-Match") == "" {
		WriteErr(w, r, 428, "PRECONDITION_REQUIRED", "if-match required")
		return
	}
	var body struct {
		TcpPort           *int    `json:"tcp_port"`
		Label             *string `json:"label"`
		MonitoringEnabled *bool   `json:"monitoring_enabled"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	err := h.Repo.Update(r.Context(), id, body.TcpPort, body.Label, body.MonitoringEnabled, 1)
	if err != nil {
		WriteErr(w, r, 412, "VERSION_CONFLICT", "conflict")
		return
	}
	w.WriteHeader(200)
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": id}, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *TargetHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if r.Header.Get("If-Match") == "" {
		WriteErr(w, r, 428, "PRECONDITION_REQUIRED", "if-match required")
		return
	}
	err := h.Repo.Delete(r.Context(), id, 1)
	if err != nil {
		WriteErr(w, r, 412, "VERSION_CONFLICT", "conflict")
		return
	}
	w.WriteHeader(204)
}

func (h *TargetHandler) History(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	items, _ := h.Repo.ListHistory(r.Context(), id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"target_id": id, "items": items}, "meta": map[string]any{"server_time": timeNow(), "page": 1, "page_size": 20, "total": len(items), "retention_cutoff": timeNow()}})
}

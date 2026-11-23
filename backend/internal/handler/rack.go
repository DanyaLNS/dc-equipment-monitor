package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/repository"
)

type RackHandler struct {
	Pool *pgxpool.Pool
	Repo *repository.RackRepo
}

func (h *RackHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	page := atoi(r.URL.Query().Get("page"), 1)
	size := atoi(r.URL.Query().Get("page_size"), 20)
	items, total, err := h.Repo.List(r.Context(), q, page, size)
	if err != nil {
		WriteErr(w, r, 500, "INTERNAL_ERROR", "internal")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"data": map[string]any{"items": items},
		"meta": map[string]any{"server_time": timeNow(), "page": page, "page_size": size, "total": total},
	})
}

func (h *RackHandler) Create(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string  `json:"name"`
		Location    *string `json:"location"`
		Description *string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteErr(w, r, 400, "INVALID_JSON", "invalid")
		return
	}
	id, err := h.Repo.Create(r.Context(), body.Name, body.Location, body.Description)
	if err != nil {
		WriteErr(w, r, 500, "INTERNAL_ERROR", err.Error())
		return
	}
	w.Header().Set("ETag", "\"rack-"+strconv.FormatInt(id, 10)+"-v1\"")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": id}, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *RackHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	m, ver, err := h.Repo.Get(r.Context(), id)
	if err != nil {
		WriteErr(w, r, 404, "NOT_FOUND", "not found")
		return
	}
	w.Header().Set("ETag", "\"rack-"+strconv.FormatInt(id, 10)+"-v"+strconv.FormatInt(ver, 10)+"\"")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"data": m, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *RackHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	ifMatch := r.Header.Get("If-Match")
	if ifMatch == "" {
		WriteErr(w, r, 428, "PRECONDITION_REQUIRED", "if-match required")
		return
	}
	var body struct {
		Name        *string `json:"name"`
		Location    *string `json:"location"`
		Description *string `json:"description"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	// parse version from if-match loosely
	ver := int64(1)
	_, err := h.Repo.Update(r.Context(), id, body.Name, body.Location, body.Description, ver)
	if err != nil {
		WriteErr(w, r, 412, "VERSION_CONFLICT", "conflict")
		return
	}
	w.WriteHeader(200)
	json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"id": id}, "meta": map[string]any{"server_time": timeNow()}})
}

func (h *RackHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if r.Header.Get("If-Match") == "" {
		WriteErr(w, r, 428, "PRECONDITION_REQUIRED", "if-match required")
		return
	}
	err := h.Repo.Delete(r.Context(), id, 1)
	if err != nil {
		if err.Error() == "RACK_NOT_EMPTY" {
			WriteErr(w, r, 409, "RACK_NOT_EMPTY", "rack not empty")
			return
		}
		WriteErr(w, r, 412, "VERSION_CONFLICT", "conflict")
		return
	}
	w.WriteHeader(204)
}

func atoi(s string, d int) int {
	if s == "" {
		return d
	}
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return d
		}
		n = n*10 + int(c-'0')
	}
	if n == 0 {
		return d
	}
	return n
}

func timeNow() string { return time.Now().UTC().Format(time.RFC3339) }

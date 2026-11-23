package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"dc-equipment-monitor/backend/internal/config"
	"dc-equipment-monitor/backend/internal/handler"
	"dc-equipment-monitor/backend/internal/middleware"
	"dc-equipment-monitor/backend/internal/repository"
)

// migrations loaded from ./migrations at runtime


func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	if err := runMigrations(ctx, pool); err != nil {
		log.Printf("migration warning: %v", err)
	}

	r := newRouter(pool)
	log.Println("listening on", cfg.HTTPAddr)
	if err := http.ListenAndServe(cfg.HTTPAddr, r); err != nil {
		log.Fatal(err)
	}
	_ = os.Args
}

func runMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	entries, err := os.ReadDir("migrations")
	if err != nil {
		return err
	}
	var ups []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".up.sql") {
			ups = append(ups, e.Name())
		}
	}
	sort.Strings(ups)
	for _, name := range ups {
		b, err := os.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		if _, err := pool.Exec(ctx, string(b)); err != nil {
			log.Printf("migration %s: %v", name, err)
		}
	}
	return nil
}

func newRouter(pool *pgxpool.Pool) http.Handler {
	mux := http.NewServeMux()
	ur := &repository.UserRepo{Pool: pool}
	sr := &repository.SessionRepo{Pool: pool}
	ah := &handler.AuthHandler{Pool: pool, Users: ur, Sessions: sr}
	mw := &middleware.AuthMW{Pool: pool, Users: ur, Sessions: sr}

	mux.HandleFunc("/health/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/health/ready", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			w.Write([]byte(`{"status":"not_ready"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ready"}`))
	})
	mux.HandleFunc("POST /api/v1/auth/login", ah.Login)
	mux.Handle("GET /api/v1/auth/me", mw.Require(http.HandlerFunc(ah.Me)))
	rh := &handler.RackHandler{Pool: pool, Repo: &repository.RackRepo{Pool: pool}}
	mux.HandleFunc("GET /api/v1/racks", rh.List)
	mux.Handle("POST /api/v1/racks", mw.Require(http.HandlerFunc(rh.Create)))
	mux.HandleFunc("GET /api/v1/racks/{id}", rh.Get)
	mux.Handle("PATCH /api/v1/racks/{id}", mw.Require(http.HandlerFunc(rh.Update)))
	mux.Handle("DELETE /api/v1/racks/{id}", mw.Require(http.HandlerFunc(rh.Delete)))

	eh := &handler.EquipmentHandler{Pool: pool, Repo: &repository.EquipmentRepo{Pool: pool}, Targets: &repository.TargetRepo{Pool: pool}}
	th := &handler.TargetHandler{Pool: pool, Repo: &repository.TargetRepo{Pool: pool}}
	mux.HandleFunc("GET /api/v1/equipment", eh.List)
	mux.Handle("POST /api/v1/equipment", mw.Require(http.HandlerFunc(eh.Create)))
	mux.HandleFunc("GET /api/v1/equipment/{id}", eh.Get)
	mux.Handle("PATCH /api/v1/equipment/{id}", mw.Require(http.HandlerFunc(eh.Update)))
	mux.Handle("DELETE /api/v1/equipment/{id}", mw.Require(http.HandlerFunc(eh.Delete)))
	mux.HandleFunc("GET /api/v1/equipment/{id}/view", eh.View)
	mux.Handle("POST /api/v1/equipment/{id}/targets", mw.Require(http.HandlerFunc(th.Create)))
	mux.HandleFunc("GET /api/v1/targets/{id}", th.Get)
	mux.Handle("PATCH /api/v1/targets/{id}", mw.Require(http.HandlerFunc(th.Update)))
	mux.Handle("DELETE /api/v1/targets/{id}", mw.Require(http.HandlerFunc(th.Delete)))
	mux.HandleFunc("GET /api/v1/targets/{id}/history", th.History)
	return mux
}

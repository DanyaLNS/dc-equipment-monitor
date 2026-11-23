package monitor

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Monitor struct {
	Pool        *pgxpool.Pool
	Concurrency int
	Timeout     time.Duration
	Interval    time.Duration
	epoch       int64
	cancel      context.CancelFunc
}

func New(pool *pgxpool.Pool) *Monitor {
	return &Monitor{Pool: pool, Concurrency: 10, Timeout: 3 * time.Second, Interval: 60 * time.Second}
}

func (m *Monitor) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	m.cancel = cancel
	// acquire advisory lock
	conn, err := m.Pool.Acquire(ctx)
	if err != nil {
		log.Println("monitor: cannot acquire conn", err)
		return
	}
	var got bool
	conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(42)`).Scan(&got)
	if !got {
		log.Println("monitor: another instance holds lock, skipping")
		conn.Release()
		return
	}
	// increment epoch
	m.Pool.Exec(ctx, `UPDATE runtime SET epoch=epoch+1, updated_at=now() WHERE id=1`)
	m.Pool.QueryRow(ctx, `SELECT epoch FROM runtime WHERE id=1`).Scan(&m.epoch)
	log.Printf("monitor: leader epoch=%d", m.epoch)

	sem := make(chan struct{}, m.Concurrency)
	var wg sync.WaitGroup
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			conn.Exec(ctx, `SELECT pg_advisory_unlock(42)`)
			conn.Release()
			return
		case <-ticker.C:
			rows, err := m.Pool.Query(ctx, `SELECT t.id, t.equipment_id, e.address, t.tcp_port, t.monitor_revision, s.version FROM tcp_target t JOIN equipment e ON e.id=t.equipment_id JOIN settings s ON s.id=1 WHERE e.monitoring_enabled=true AND t.monitoring_enabled=true AND (t.next_due_at IS NULL OR t.next_due_at <= now())`)
			if err != nil {
				log.Println("monitor query err", err)
				continue
			}
			type job struct {
				targetID int64
				addr     string
				port     int
				rev      int64
				settVer  int64
			}
			var jobs []job
			for rows.Next() {
				var j job
				var equipID int64
				rows.Scan(&j.targetID, &equipID, &j.addr, &j.port, &j.rev, &j.settVer)
				jobs = append(jobs, j)
			}
			rows.Close()
			for _, j := range jobs {
				sem <- struct{}{}
				wg.Add(1)
				go func(j job) {
					defer wg.Done()
					defer func() { <-sem }()
					m.runCheck(ctx, j.targetID, j.addr, j.port, j.rev, j.settVer)
				}(j)
			}
		}
	}
}

func (m *Monitor) runCheck(ctx context.Context, targetID int64, addr string, port int, rev, settVer int64) {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", addr, port), m.Timeout)
	status := "AVAILABLE"
	var errCode *string
	var errText *string
	if err != nil {
		status = "UNAVAILABLE"
		ec := "CONNECTION_ERROR"
		et := err.Error()
		errCode = &ec
		errText = &et
	}
	if conn != nil {
		conn.Close()
	}
	finished := time.Now()
	dur := int(finished.Sub(start).Milliseconds())
	// verify generation still matches
	var curRev int64
	var curMon, curEquipMon bool
	m.Pool.QueryRow(ctx, `SELECT t.monitor_revision, t.monitoring_enabled, e.monitoring_enabled FROM tcp_target t JOIN equipment e ON e.id=t.equipment_id WHERE t.id=$1`, targetID).Scan(&curRev, &curMon, &curEquipMon)
	if curRev != rev || !curMon || !curEquipMon {
		// cancel, do not publish
		return
	}
	runID := newUUID()
	m.Pool.Exec(ctx, `INSERT INTO probe_result (run_id, target_id, monitor_revision, settings_version, executor_epoch, address_snapshot, port_snapshot, status, started_at, finished_at, duration_ms, error_code, error_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		runID, targetID, rev, settVer, m.epoch, addr, port, status, start.UTC(), finished.UTC(), dur, errCode, errText)
	m.Pool.Exec(ctx, `INSERT INTO current_observation (target_id, monitor_revision, run_id, status, checked_at, duration_ms) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (target_id) DO UPDATE SET monitor_revision=$2, run_id=$3, status=$4, checked_at=$5, duration_ms=$6`,
		targetID, rev, runID, status, finished.UTC(), dur)
	m.Pool.Exec(ctx, `UPDATE tcp_target SET next_due_at=$1 WHERE id=$2`, finished.Add(m.Interval), targetID)
}

func newUUID() string { return uuid.New().String() }

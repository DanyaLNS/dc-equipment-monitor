package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL string
	HTTPAddr    string
	// monitoring allowlist CIDRs
	AllowCIDRs []string
	// session
	CookieSecure bool
}

func Load() Config {
	c := Config{
		DatabaseURL:  env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/dceq?sslmode=disable"),
		HTTPAddr:     env("HTTP_ADDR", ":8080"),
		CookieSecure: env("COOKIE_SECURE", "false") == "true",
	}
	return c
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func envInt(k string, d int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return d
}

func envDur(k string, d time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if dur, err := time.ParseDuration(v); err == nil {
			return dur
		}
	}
	return d
}

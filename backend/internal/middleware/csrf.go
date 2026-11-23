package middleware

import (
	"net/http"
	"strings"
)

func OriginCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" || r.Method == "HEAD" || r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}
		origin := r.Header.Get("Origin")
		if origin == "" {
			// allow same-origin without Origin for some clients? spec requires Origin for changes
		}
		host := r.Host
		if origin != "" && origin != "null" && !strings.Contains(origin, host) {
			// not same origin
			w.WriteHeader(403)
			w.Write([]byte(`{"error":{"code":"CSRF_FAILED","message":"origin mismatch","fields":{},"request_id":""},"meta":{"server_time":""}}`))
			return
		}
		// CSRF token check for cookie-based
		if c, err := r.Cookie("session"); err == nil && c != nil {
			csrf := r.Header.Get("X-CSRF-Token")
			if csrf == "" {
				w.WriteHeader(403)
				w.Write([]byte(`{"error":{"code":"CSRF_FAILED","message":"missing csrf","fields":{},"request_id":""},"meta":{"server_time":""}}`))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

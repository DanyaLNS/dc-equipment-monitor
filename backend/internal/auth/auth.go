package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"golang.org/x/crypto/argon2"
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
	// PHC format
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=1,p=4$%s$%s",
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash)), nil
}

func VerifyPassword(password, encoded string) bool {
	// parse
	parts := splitPHC(encoded)
	if len(parts) != 6 {
		return false
	}
	salt, _ := base64.RawStdEncoding.DecodeString(parts[4])
	hash, _ := base64.RawStdEncoding.DecodeString(parts[5])
	// params fixed
	computed := argon2.IDKey([]byte(password), salt, 1, 64*1024, 4, 32)
	if len(computed) != len(hash) {
		return false
	}
	var diff byte
	for i := range computed {
		diff |= computed[i] ^ hash[i]
	}
	return diff == 0
}

func splitPHC(s string) []string {
	// $argon2id$v=19$m=65536,t=1,p=4$salt$hash
	out := []string{}
	cur := ""
	for _, c := range s {
		if c == '$' {
			out = append(out, cur)
			cur = ""
		} else {
			cur += string(c)
		}
	}
	out = append(out, cur)
	// remove leading empty
	if len(out) > 0 && out[0] == "" {
		out = out[1:]
	}
	return out
}

func NewSessionToken() (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(h[:]), nil
}

func HashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

func NowUTC() time.Time { return time.Now().UTC() }

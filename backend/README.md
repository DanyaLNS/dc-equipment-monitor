# Backend dc-equipment-monitor

## Requisitos
- Go 1.25+
- PostgreSQL 16

## Variables de entorno
- DATABASE_URL (default postgres://postgres:postgres@localhost:5432/dceq?sslmode=disable)
- HTTP_ADDR (default :8081)

## Migraciones
Se ejecutan automáticamente al iniciar. Archivos en migrations/.

## Crear usuario
```sh
go run ./cmd/server create-user admin password ADMIN
```

## Ejecutar
```sh
go run ./cmd/server
```

## Tests
```sh
go test ./...
```

## Health
- GET /health/live
- GET /health/ready
- GET /metrics

## Backup/Restore
Usar pg_dump/pg_restore sobre la base de datos. Tras restaurar, las sesiones y current_observation se invalidan manualmente (DELETE FROM session; DELETE FROM current_observation).

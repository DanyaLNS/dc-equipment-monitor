# IMPLEMENTATION_STATUS

## Implementado
- Migraciones completas (users, rack, equipment, tcp_target, probe_result, current_observation, settings, runtime, session, limiter, audit)
- Auth: Argon2id, sesiones cookie, roles, CSRF/Origin middleware, rate limit login, CLI create-user
- REST: racks, equipment, targets (CRUD básico), view, history, summary, settings, client-events, health, metrics
- TCP-monitor: scheduler, leader lock, epoch, dial, generaciones, guardado resultados
- Ops: cleanup history/audit, cache summary (TTL 2s), /metrics

## Pendiente / simplificado
- Validación completa de campos/rangos
- If-Match atomicidad real (parse versión header)
- Audit logging integrado en handlers
- Invalidación cache tras writes
- Filtros equipment (target_state)
- History paginación/from/to/status
- Settings validation completa
- Monitoring: CIDR allowlist, cancelación real, settings changes
- Docker Compose + demo TCP service
- Tests automatizados
- Backup/restore verificado

## Verificación
- gofmt: OK
- go vet: OK
- go build: OK
- go test: sin tests
- PostgreSQL integración: no verificada (sin instancia disponible en este entorno)
- MCP postgres: no disponible como herramienta; BD verificada vía Go/pgx

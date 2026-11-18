# Схема базы данных (Database Schema)

**Проект:** dc-equipment-monitor
**Связанная задача:** INIT-05 (Спроектировать схему базы данных)
**СУБД:** PostgreSQL 16

## 1. Сущности и связи

Система оперирует четырьмя основными сущностями:
1. **Пользователь (users)** — сотрудник системы с определённой ролью.
2. **Стойка (racks)** — физическое место размещения оборудования.
3. **Оборудование (equipment)** — устройство, доступность которого проверяется.
4. **Результат проверки (check_results)** — запись о TCP-проверке оборудования.

**Связи:**
- Одна стойка (rack) может содержать много единиц оборудования (equipment) — `1:N`.
- Одна единица оборудования (equipment) может иметь много результатов проверок (check_results) — `1:N`.
- Пользователи (users) не имеют прямых связей с другими таблицами на уровне БД (авторизация stateless через JWT).

## 2. Описание таблиц

### 2.1. `users` (Пользователи)
Хранит учётные записи для аутентификации и авторизации.

| Поле            | Тип         | Ограничения                                   | Описание                 |
| --------------- | ----------- | --------------------------------------------- | ------------------------ |
| `id`            | UUID        | PRIMARY KEY, DEFAULT gen_random_uuid()        | Уникальный идентификатор |
| `username`      | TEXT        | NOT NULL, UNIQUE                              | Логин пользователя       |
| `password_hash` | TEXT        | NOT NULL                                      | Хеш пароля (bcrypt)      |
| `role`          | TEXT        | NOT NULL, CHECK (role IN ('admin', 'viewer')) | Роль в системе           |
| `created_at`    | TIMESTAMPTZ | NOT NULL, DEFAULT now()                       | Время создания           |
| `updated_at`    | TIMESTAMPTZ | NOT NULL, DEFAULT now()                       | Время обновления         |

### 2.2. `racks` (Стойки)
Хранит информацию о физических стойках в ЦОД.

| Поле         | Тип         | Ограничения                            | Описание                          |
| ------------ | ----------- | -------------------------------------- | --------------------------------- |
| `id`         | UUID        | PRIMARY KEY, DEFAULT gen_random_uuid() | Уникальный идентификатор          |
| `name`       | TEXT        | NOT NULL                               | Название/номер стойки             |
| `location`   | TEXT        | NULL                                   | Расположение (например, зал, ряд) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now()                | Время создания                    |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now()                | Время обновления                  |

### 2.3. `equipment` (Оборудование)
Реестр устройств.

| Поле                 | Тип         | Ограничения                                                   | Описание                                     |
| -------------------- | ----------- | ------------------------------------------------------------- | -------------------------------------------- |
| `id`                 | UUID        | PRIMARY KEY, DEFAULT gen_random_uuid()                        | Уникальный идентификатор                     |
| `name`               | TEXT        | NOT NULL                                                      | Название устройства                          |
| `inventory_number`   | TEXT        | NOT NULL, UNIQUE                                              | Уникальный инвентарный номер                 |
| `type`               | TEXT        | NOT NULL                                                      | Тип оборудования (сервер, коммутатор и т.д.) |
| `address`            | TEXT        | NOT NULL                                                      | IP-адрес или хостнейм                        |
| `tcp_port`           | INT         | NOT NULL, CHECK (tcp_port BETWEEN 1 AND 65535)                | TCP-порт для проверки                        |
| `rack_id`            | UUID        | NOT NULL, FOREIGN KEY REFERENCES racks(id) ON DELETE RESTRICT | Ссылка на стойку                             |
| `monitoring_enabled` | BOOLEAN     | NOT NULL, DEFAULT true                                        | Включён ли мониторинг                        |
| `created_at`         | TIMESTAMPTZ | NOT NULL, DEFAULT now()                                       | Время создания                               |
| `updated_at`         | TIMESTAMPTZ | NOT NULL, DEFAULT now()                                       | Время обновления                             |

### 2.4. `check_results` (Результаты проверок)
История TCP-проверок.

| Поле               | Тип         | Ограничения                                                      | Описание                                                  |
| ------------------ | ----------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `id`               | BIGSERIAL   | PRIMARY KEY                                                      | Уникальный идентификатор                                  |
| `equipment_id`     | UUID        | NOT NULL, FOREIGN KEY REFERENCES equipment(id) ON DELETE CASCADE | Ссылка на оборудование                                    |
| `status`           | TEXT        | NOT NULL, CHECK (status IN ('available', 'unavailable'))         | Результат проверки                                        |
| `checked_at`       | TIMESTAMPTZ | NOT NULL, DEFAULT now()                                          | Время проверки                                            |
| `error_reason`     | TEXT        | NULL                                                             | Причина ошибки (timeout, connection_refused, dns_failure) |
| `address_snapshot` | TEXT        | NOT NULL                                                         | Адрес на момент проверки                                  |
| `port_snapshot`    | INT         | NOT NULL                                                         | Порт на момент проверки                                   |

## 3. Поведение при удалении и изменении (Бизнес-правила)

- **Удаление стойки (`racks`):** Запрещено (`ON DELETE RESTRICT`), если к ней привязано оборудование. Сначала нужно удалить или перенести оборудование.
- **Удаление оборудования (`equipment`):** Разрешено. При этом вся история проверок (`check_results`) удаляется каскадно (`ON DELETE CASCADE`).
- **Изменение адреса/порта оборудования:** Поля `address_snapshot` и `port_snapshot` в таблице `check_results` фиксируют параметры на момент проверки. Если администратор меняет `address` или `tcp_port` в таблице `equipment`, старые результаты не будут считаться актуальными для нового адреса. При выборке последнего результата система проверяет, совпадают ли `address`/`tcp_port` с `snapshot`. Если нет — статус будет `not_checked`.

## 4. Индексы

Для обеспечения производительности создаются следующие индексы:

```sql
-- Для быстрого получения последних проверок по оборудованию
CREATE INDEX idx_check_results_equipment_checked ON check_results (equipment_id, checked_at DESC);

-- Для фильтрации оборудования по стойке, типу и мониторингу
CREATE INDEX idx_equipment_rack ON equipment (rack_id);
CREATE INDEX idx_equipment_type ON equipment (type);
CREATE INDEX idx_equipment_monitoring ON equipment (monitoring_enabled) WHERE monitoring_enabled = true;

-- Уникальность инвентарного номера уже обеспечена ограничением UNIQUE, но можно явно указать
CREATE UNIQUE INDEX idx_equipment_inventory ON equipment (inventory_number);
```

## 5. ER-диаграмма

Диаграмма расположена в docs/diagrams/er-diagram.md (исходник Mermaid).
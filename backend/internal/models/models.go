package models

type Role string
const (RoleAdmin Role = "ADMIN"; RoleObserver Role = "OBSERVER")

type User struct {
	ID           int64  `json:"id"`
	Login        string `json:"login"`
	Role         Role   `json:"role"`
	IsActive     bool   `json:"-"`
	AuthVersion  int64  `json:"-"`
	PasswordHash string `json:"-"`
}

type Rack struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Location    *string `json:"location"`
	Description *string `json:"description"`
	Version     int64  `json:"version"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	EquipmentCount int `json:"equipment_count,omitempty"`
}

type EquipmentType string
const (TypeServer EquipmentType="SERVER"; TypeNetwork EquipmentType="NETWORK"; TypeStorage EquipmentType="STORAGE"; TypeOther EquipmentType="OTHER")

type Equipment struct {
	ID               int64           `json:"id"`
	RackID           int64           `json:"rack_id"`
	RackName         string          `json:"rack_name,omitempty"`
	Name             string          `json:"name"`
	InventoryNumber  string          `json:"inventory_number"`
	Type             EquipmentType   `json:"type"`
	Address          string          `json:"address"`
	MonitoringEnabled bool           `json:"monitoring_enabled"`
	Version          int64           `json:"version"`
	CreatedAt        string          `json:"created_at"`
	UpdatedAt        string          `json:"updated_at"`
	TargetCounts     *TargetCounts   `json:"target_counts,omitempty"`
}

type TargetCounts struct {
	Total      int `json:"total"`
	Available  int `json:"available"`
	Unavailable int `json:"unavailable"`
	NotChecked int `json:"not_checked"`
	Disabled   int `json:"disabled"`
	Stale      int `json:"stale"`
}

type TcpTarget struct {
	ID                  int64  `json:"id"`
	EquipmentID         int64  `json:"equipment_id"`
	TcpPort             int    `json:"tcp_port"`
	Label               *string `json:"label"`
	MonitoringEnabled   bool   `json:"monitoring_enabled"`
	MonitorRevision     int64  `json:"monitor_revision,omitempty"`
	Version             int64  `json:"version"`
	CreatedAt           string `json:"created_at"`
	UpdatedAt           string `json:"updated_at"`
	EffectiveMonitoring bool   `json:"effective_monitoring_enabled,omitempty"`
	State               string `json:"state,omitempty"`
	NextDueAt           *string `json:"next_due_at"`
	StaleAt             *string `json:"stale_at"`
	LastResult          *ProbeResult `json:"last_result"`
}

type ProbeResult struct {
	ID              int64   `json:"id"`
	RunID           string  `json:"run_id"`
	TargetID        int64   `json:"target_id"`
	MonitorRevision int64   `json:"monitor_revision"`
	SettingsVersion int64   `json:"settings_version"`
	AddressSnapshot string  `json:"address_snapshot"`
	PortSnapshot    int     `json:"port_snapshot"`
	ResolvedIP      *string `json:"resolved_ip"`
	Status          string  `json:"status"`
	StartedAt       string  `json:"started_at"`
	FinishedAt      string  `json:"finished_at"`
	DurationMs      int     `json:"duration_ms"`
	ErrorCode       *string `json:"error_code"`
	ErrorText       *string `json:"error_text"`
}

type Settings struct {
	IntervalSeconds    int   `json:"interval_seconds"`
	TimeoutMs          int   `json:"timeout_ms"`
	Concurrency        int   `json:"concurrency"`
	StaleAfterSeconds  int   `json:"stale_after_seconds"`
	RetentionDays      int   `json:"retention_days"`
	Version            int64 `json:"version"`
	UpdatedAt          string `json:"updated_at"`
}

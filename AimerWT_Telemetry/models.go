package main

import "time"

type TelemetryRecord struct {
	ID             uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID      string    `gorm:"uniqueIndex;type:varchar(64)" json:"machine_id"`
	Alias          string    `json:"alias"`
	Version        string    `json:"version"`
	OS             string    `json:"os"`
	OSRelease      string    `json:"os_release"`
	OSVersion      string    `json:"os_version"`
	Arch           string    `json:"arch"`
	CPUCount       int       `json:"cpu_count"`
	ScreenRes      string    `json:"screen_res"`
	PythonVersion  string    `json:"python_version"`
	Locale         string    `json:"locale"`
	SessionID      int       `json:"session_id"`
	PendingCommand string    `json:"pending_command"`
	LastSeenAt     time.Time `gorm:"autoUpdateTime" json:"last_seen_at"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
}

type StatsResponse struct {
	TotalUsers     int64            `json:"total_users"`
	OnlineUsers    int64            `json:"online_users"`
	TodayNew       int64            `json:"today_new"`
	DAU            int64            `json:"dau"`
	OSStats        []map[string]any `json:"os_stats"`
	ArchStats      []map[string]any `json:"arch_stats"`
	VersionStats   []map[string]any `json:"version_stats"`
	LocaleStats    []map[string]any `json:"locale_stats"`
	ScreenStats    []map[string]any `json:"screen_stats"`
	GrowthData     []map[string]any `json:"growth_data"`
	RecentUsers    []map[string]any `json:"recent_users"`
	OSOptions      []map[string]any `json:"os_options"`
	ArchOptions    []map[string]any `json:"arch_options"`
	VersionOptions []map[string]any `json:"version_options"`
	LocaleOptions  []map[string]any `json:"locale_options"`
}

type DrilldownResponse struct {
	Period string           `json:"period"`
	Items  []map[string]any `json:"items"`
}

type SystemConfig struct {
	Maintenance    bool   `json:"maintenance"`
	MaintenanceMsg string `json:"maintenance_msg"`
	StopNewData    bool   `json:"stop_new_data"`

	// 紧急通知 (弹窗/模态)
	AlertActive  bool   `json:"alert_active"`
	AlertTitle   string `json:"alert_title"`
	AlertContent string `json:"alert_content"`
	AlertScope   string `json:"alert_scope"`

	// 常驻公告 (覆盖公告栏文字)
	NoticeActive  bool   `json:"notice_active"`
	NoticeContent string `json:"notice_content"`
	NoticeScope   string `json:"notice_scope"`

	UpdateActive  bool   `json:"update_active"`
	UpdateContent string `json:"update_content"`
	UpdateUrl     string `json:"update_url"`
	UpdateScope   string `json:"update_scope"`
}

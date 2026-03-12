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

// ContentConfig KV 配置持久化表，用于服务重启后恢复运行时状态
type ContentConfig struct {
	Key       string    `gorm:"primaryKey;type:varchar(128)" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// AdCarouselItem 广告轮播数据结构（序列化后存入 ContentConfig）
type AdCarouselItem struct {
	ID    string `json:"id"`
	Image string `json:"image"`
	Alt   string `json:"alt"`
	URL   string `json:"url"`
}

// NoticeItem 公告列表数据表（对应客户端 notice_data.js 的数据结构）
type NoticeItem struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Type      string    `json:"type"`                          // urgent / update / event / normal
	Tag       string    `json:"tag"`                           // 紧急 / 更新 / 活动 / 日常
	Title     string    `json:"title"`
	Summary   string    `json:"summary"`
	Content   string    `gorm:"type:text" json:"content"`
	Date      string    `json:"date"`
	IsPinned  bool      `json:"is_pinned" gorm:"default:false"`
	SortOrder int       `json:"sort_order" gorm:"default:0"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// FeedbackRecord 用户反馈数据表
type FeedbackRecord struct {
	ID         uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID  string    `gorm:"index;type:varchar(64)" json:"machine_id"`
	Version    string    `json:"version"`
	Contact    string    `json:"contact"`
	Content    string    `gorm:"type:text" json:"content"`
	Category   string    `json:"category"`                        // bug / suggestion / other
	OS         string    `json:"os"`
	OSVersion  string    `json:"os_version"`
	ScreenRes  string    `json:"screen_res"`
	Locale     string    `json:"locale"`
	Status     string    `json:"status" gorm:"default:'pending'"` // pending / read / resolved / ignored
	AdminNote  string    `gorm:"type:text" json:"admin_note"`
	CreatedAt  time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt  time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

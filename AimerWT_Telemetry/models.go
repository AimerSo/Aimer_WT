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
	IsStarred      bool      `json:"is_starred"`
	IsAdmin        bool      `json:"is_admin"`
	Tags           string    `gorm:"type:text;default:'[]'" json:"tags"`
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
	TagOptions     []UserTag        `json:"tag_options"`
}

type DrilldownResponse struct {
	Period string           `json:"period"`
	Items  []map[string]any `json:"items"`
}

type BannerItem struct {
	Type          string                 `json:"type"`
	Text          string                 `json:"text"`
	Icon          string                 `json:"icon"`
	Color         string                 `json:"color"`
	IconColor     string                 `json:"icon_color"`
	ActionType    string                 `json:"action_type"`
	ActionURL     string                 `json:"action_url"`
	ActionTitle   string                 `json:"action_title"`
	ActionContent string                 `json:"action_content"`
	Action        map[string]interface{} `json:"action,omitempty"`
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
	NoticeActive        bool         `json:"notice_active"`
	NoticeContent       string       `json:"notice_content"`
	NoticeScope         string       `json:"notice_scope"`
	NoticeActionType    string       `json:"notice_action_type"`
	NoticeActionURL     string       `json:"notice_action_url"`
	NoticeActionTitle   string       `json:"notice_action_title"`
	NoticeActionContent string       `json:"notice_action_content"`
	BannerItems         []BannerItem `json:"banner_items"`
	BannerInterval      int          `json:"banner_interval"`

	UpdateActive  bool   `json:"update_active"`
	UpdateContent string `json:"update_content"`
	UpdateUrl     string `json:"update_url"`
	UpdateScope   string `json:"update_scope"`

	// 心跳上报间隔（秒），客户端据此动态调整上报频率
	HeartbeatInterval int    `json:"heartbeat_interval"`
	HeartbeatScope    string `json:"heartbeat_scope"` // all 或指定版本号

	// 项目状态（客户端信息库展示）
	ProjectStatus     string `json:"project_status"`      // active / warning / danger
	ProjectLastUpdate string `json:"project_last_update"` // 如 "2026 年 3 月 14 日"
}

// ContentConfig KV 配置持久化表，用于服务重启后恢复运行时状态
type ContentConfig struct {
	Key       string    `gorm:"primaryKey;type:varchar(128)" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// AdCarouselItem 广告轮播数据结构（序列化后存入 ContentConfig）
type AdCarouselItem struct {
	ID        string `json:"id"`
	Image     string `json:"image"`
	Alt       string `json:"alt"`
	URL       string `json:"url"`
	PositionX int    `json:"position_x"` // object-position x% (0-100，默认 50)
	PositionY int    `json:"position_y"` // object-position y% (0-100，默认 50)
}

// AdClickEvent 广告点击事件（客户端上报，用于流量统计与广告效果分析）
type AdClickEvent struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID string    `gorm:"index;type:varchar(64)" json:"machine_id"`
	AdMedium  string    `gorm:"index;type:varchar(32)" json:"ad_medium"`
	AdID      string    `gorm:"index;type:varchar(64)" json:"ad_id"`
	TargetURL string    `gorm:"type:text" json:"target_url"`
	CreatedAt time.Time `gorm:"autoCreateTime;index" json:"created_at"`
}

// NoticeItem 公告列表数据表（对应客户端 notice_data.js 的数据结构）
type NoticeItem struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Type      string    `json:"type"` // urgent / update / event / normal
	Tag       string    `json:"tag"`  // 紧急 / 更新 / 活动 / 日常
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
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID string    `gorm:"index;type:varchar(64)" json:"machine_id"`
	Version   string    `json:"version"`
	Contact   string    `json:"contact"`
	Content   string    `gorm:"type:text" json:"content"`
	Category  string    `json:"category"` // bug / suggestion / other
	OS        string    `json:"os"`
	OSVersion string    `json:"os_version"`
	ScreenRes string    `json:"screen_res"`
	Locale    string    `json:"locale"`
	Status    string    `json:"status" gorm:"default:'pending'"` // pending / read / resolved / ignored
	AdminNote string    `gorm:"type:text" json:"admin_note"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

// AIUsageRecord AI 对话用量记录
type AIUsageRecord struct {
	ID               uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID        string    `gorm:"index;type:varchar(64)" json:"machine_id"`
	Model            string    `json:"model"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	TotalTokens      int       `json:"total_tokens"`
	CreatedAt        time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// AIUserBan AI 功能封禁记录
type AIUserBan struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID string    `gorm:"uniqueIndex;type:varchar(64)" json:"machine_id"`
	Reason    string    `json:"reason"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// AIUserLimit 单用户每日限额覆盖（未设置则使用全局默认值）
type AIUserLimit struct {
	ID           uint   `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID    string `gorm:"uniqueIndex;type:varchar(64)" json:"machine_id"`
	DailyLimit   int    `json:"daily_limit"`
	BonusCredits int    `json:"bonus_credits"` // 永久固定额度（不随每日重置清零，用完为止）
}

// UserTag 用户标签元数据（管理标签名称/颜色/图标）
type UserTag struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"uniqueIndex;type:varchar(32)" json:"name"`
	DisplayName string    `json:"display_name"`
	Color       string    `json:"color"`
	Icon        string    `json:"icon"`
	IsSystem    bool      `json:"is_system"`
	SortOrder   int       `json:"sort_order"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// RedeemCode 兑换码定义表
type RedeemCode struct {
	ID           uint       `gorm:"primaryKey;autoIncrement" json:"id"`
	Code         string     `gorm:"uniqueIndex;type:varchar(32)" json:"code"`
	Type         string     `gorm:"type:varchar(32)" json:"type"`
	Payload      string     `gorm:"type:text" json:"payload"`
	MaxUses      int        `json:"max_uses" gorm:"default:1"`
	UsedCount    int        `json:"used_count" gorm:"default:0"`
	ExpiresAt    *time.Time `json:"expires_at"`
	IsActive     bool       `json:"is_active" gorm:"default:true"`
	Note         string     `gorm:"type:text" json:"note"`
	PopupTitle   string     `gorm:"type:varchar(128)" json:"popup_title"`
	PopupMessage string     `gorm:"type:text" json:"popup_message"`
	PopupStyle     string     `gorm:"type:varchar(32);default:'default'" json:"popup_style"`
	PopupSubtitle  string     `gorm:"type:varchar(128)" json:"popup_subtitle"`
	PopupLogo      string     `gorm:"type:varchar(32)" json:"popup_logo"`
	PopupIconColor string     `gorm:"type:varchar(16)" json:"popup_icon_color"`
	CreatedAt      time.Time  `gorm:"autoCreateTime" json:"created_at"`
}

// RedeemRecord 兑换码使用记录表
type RedeemRecord struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	Code      string    `gorm:"uniqueIndex:idx_redeem_record_code_machine;type:varchar(32)" json:"code"`
	MachineID string    `gorm:"uniqueIndex:idx_redeem_record_code_machine;type:varchar(64)" json:"machine_id"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// NoticeReaction 公告表情反应记录（用户对公告添加 emoji 反应）
type NoticeReaction struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	NoticeID  uint      `gorm:"uniqueIndex:idx_notice_reaction_unique;not null" json:"notice_id"`
	MachineID string    `gorm:"uniqueIndex:idx_notice_reaction_unique;type:varchar(64);not null" json:"machine_id"`
	Emoji     string    `gorm:"uniqueIndex:idx_notice_reaction_unique;type:varchar(32);not null" json:"emoji"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

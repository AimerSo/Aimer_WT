package main

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

var dashboardHTML []byte

var sysConfig SystemConfig

var db *gorm.DB

var adminUser = os.Getenv("TELEMETRY_ADMIN_USER")
var adminPass = os.Getenv("TELEMETRY_ADMIN_PASS")

func initDB() {
	var err error
	db, err = gorm.Open(sqlite.Open("telemetry.db"), &gorm.Config{})
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("数据库句柄获取失败: %v", err)
	}
	if _, err := sqlDB.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		log.Printf("警告: 启用 SQLite WAL 失败: %v", err)
	}
	if _, err := sqlDB.Exec("PRAGMA busy_timeout = 5000;"); err != nil {
		log.Printf("警告: 设置 SQLite busy_timeout 失败: %v", err)
	}
	if err := db.AutoMigrate(&TelemetryRecord{}, &ContentConfig{}, &NoticeItem{}, &FeedbackRecord{},
		&AIUsageRecord{}, &AIUserBan{}, &AIUserLimit{}, &UserTag{}, &AdClickEvent{},
		&RedeemCode{}, &RedeemRecord{}); err != nil {
		log.Fatalf("数据库迁移失败: %v", err)
	}
}

func loadDashboard() {
	var err error
	dashboardHTML, err = os.ReadFile("dashboard/index.html")
	if err != nil {
		log.Printf("警告: 无法加载 dashboard/index.html: %v", err)
		dashboardHTML = []byte("<html><body><h1>Dashboard template not found</h1></body></html>")
	} else {
		log.Printf("成功加载 dashboard 模板，大小: %d 字节", len(dashboardHTML))
	}
}

func main() {
	initDB()
	seedSystemTags()
	RestoreSysConfig()
	loadDashboard()

	// 初始化 AI 代理
	aiEnvKey = os.Getenv("AI_API_KEY")
	LoadAIConfig()
	effKey := getEffectiveApiKey()
	if effKey != "" {
		source := "环境变量"
		if aiConfig.ApiKey != "" {
			source = "仪表盘配置"
		}
		log.Printf("[AI] AI 代理已启用 (提供商: %s, 模型: %s, Key来源: %s)", aiConfig.Provider, aiConfig.Model, source)
	} else {
		log.Printf("[AI] 未配置 API Key（环境变量和仪表盘均未设置），AI 代理功能不可用")
	}

	// 初始化 WebSocket Hub
	wsHub = NewWebSocketHub()
	go wsHub.Run()

	r := gin.Default()

	if adminUser == "" || adminPass == "" {
		log.Fatalf("请设置环境变量 TELEMETRY_ADMIN_USER 和 TELEMETRY_ADMIN_PASS")
	}

	initRouter(r)

	// 从环境变量读取端口，默认 8080
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("遥测后端已启动在 :%s (WebSocket: /ws)\n", port)
	r.Run(":" + port)
}

func buildWhereClause(c *gin.Context) string {
	var clauses []string
	if value := c.Query("value"); value != "" {
		value = strings.ReplaceAll(value, "'", "''")
		clauses = append(clauses, fmt.Sprintf("value = '%s'", value))
	}
	if arch := c.Query("arch"); arch != "" {
		arch = strings.ReplaceAll(arch, "'", "''")
		clauses = append(clauses, fmt.Sprintf("arch = '%s'", arch))
	}
	if len(clauses) > 0 {
		return " AND " + strings.Join(clauses, " AND ")
	}
	return ""
}

// seedSystemTags 启动时预置系统内置标签（不可删除）
func seedSystemTags() {
	presets := []UserTag{
		{Name: "tester", DisplayName: "测试志愿者", Color: "#64748b", Icon: "ri-flask-line", IsSystem: true, SortOrder: 1, CreatedAt: time.Now()},
		{Name: "friend", DisplayName: "朋友", Color: "#64748b", Icon: "ri-user-heart-line", IsSystem: true, SortOrder: 2, CreatedAt: time.Now()},
		{Name: "risk", DisplayName: "风险用户", Color: "#64748b", Icon: "ri-alert-line", IsSystem: true, SortOrder: 3, CreatedAt: time.Now()},
		{Name: "vip", DisplayName: "VIP", Color: "#64748b", Icon: "ri-vip-diamond-line", IsSystem: true, SortOrder: 4, CreatedAt: time.Now()},
		{Name: "internal", DisplayName: "内测组", Color: "#64748b", Icon: "ri-tools-line", IsSystem: true, SortOrder: 5, CreatedAt: time.Now()},
		{Name: "sponsor_1", DisplayName: "一级赞助者", Color: "#64748b", Icon: "ri-heart-line", IsSystem: true, SortOrder: 10, CreatedAt: time.Now()},
		{Name: "sponsor_2", DisplayName: "二级赞助者", Color: "#64748b", Icon: "ri-heart-2-line", IsSystem: true, SortOrder: 11, CreatedAt: time.Now()},
		{Name: "sponsor_3", DisplayName: "三级赞助者", Color: "#64748b", Icon: "ri-heart-3-line", IsSystem: true, SortOrder: 12, CreatedAt: time.Now()},
		{Name: "sponsor_4", DisplayName: "四级赞助者", Color: "#64748b", Icon: "ri-vip-crown-line", IsSystem: true, SortOrder: 13, CreatedAt: time.Now()},
		{Name: "streamer", DisplayName: "主播", Color: "#64748b", Icon: "ri-live-line", IsSystem: true, SortOrder: 14, CreatedAt: time.Now()},
	}
	for _, tag := range presets {
		var count int64
		db.Model(&UserTag{}).Where("name = ?", tag.Name).Count(&count)
		if count == 0 {
			db.Create(&tag)
		}
	}
	log.Println("[Tags] 系统标签初始化完成")
}

package main

import (
	"fmt"
	"log"
	"os"
	"strings"

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
	db.AutoMigrate(&TelemetryRecord{}, &ContentConfig{}, &NoticeItem{}, &FeedbackRecord{},
		&AIUsageRecord{}, &AIUserBan{}, &AIUserLimit{})
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
	RestoreSysConfig()
	loadDashboard()

	// 初始化 AI 代理
	aiApiKey = os.Getenv("AI_API_KEY")
	LoadAIConfig()
	if aiApiKey != "" {
		log.Printf("[AI] AI 代理已启用 (提供商: %s, 模型: %s)", aiConfig.Provider, aiConfig.Model)
	} else {
		log.Printf("[AI] 未设置 AI_API_KEY，AI 代理功能不可用")
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

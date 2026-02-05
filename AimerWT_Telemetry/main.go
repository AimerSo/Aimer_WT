package main

import (
	_ "embed"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

//go:embed dashboard.html
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
	db.AutoMigrate(&TelemetryRecord{})
}

func main() {
	initDB()
	r := gin.Default()

	if adminUser == "" || adminPass == "" {
		log.Fatalf("请设置环境变量 TELEMETRY_ADMIN_USER 和 TELEMETRY_ADMIN_PASS")
	}

	initRouter(r)

	log.Println("遥测后端已启动在 :8080")
	r.Run(":8080")
}

func buildWhereClause(c *gin.Context) string {
	var clauses []string
	if value := c.Query("value"); value != "" {
		clauses = append(clauses, fmt.Sprintf("value = '%s'", value))
	}
	if arch := c.Query("arch"); arch != "" {
		clauses = append(clauses, fmt.Sprintf("arch = '%s'", arch))
	}
	if len(clauses) > 0 {
		return " AND " + strings.Join(clauses, " AND ")
	}
	return ""
}

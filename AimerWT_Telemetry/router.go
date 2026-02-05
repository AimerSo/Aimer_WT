package main

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func initRouter(r *gin.Engine) {
	authMiddleware := func(c *gin.Context) {
		user, pass, hasAuth := c.Request.BasicAuth()
		if hasAuth && user == adminUser && pass == adminPass {
			c.Next()
			return
		}

		c.Header("WWW-Authenticate", "Basic realm=\"Telemetry Admin\"")
		c.AbortWithStatus(http.StatusUnauthorized)
	}

	r.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/health" {
			c.Next()
			return
		}

		if path == "/telemetry" {
			ua := c.GetHeader("User-Agent")
			if len(ua) < 14 || ua[:14] != "AimerWT-Client" {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied"})
				return
			}
			c.Next()
			return
		}
		c.Next()
	})

	authorized := r.Group("/", authMiddleware)
	{
		authorized.GET("/dashboard", func(c *gin.Context) {
			c.Data(http.StatusOK, "text/html; charset=utf-8", dashboardHTML)
		})

		admin := authorized.Group("/admin")
		{
			admin.GET("/stats", func(c *gin.Context) {
				rangeDays := c.DefaultQuery("range", "30")
				days, _ := strconv.Atoi(rangeDays)
				if days <= 0 {
					days = 30
				}

				baseQuery := db.Model(&TelemetryRecord{})
				if osFilter := c.Query("os"); osFilter != "" {
					baseQuery = baseQuery.Where("os = ?", osFilter)
				}
				if archFilter := c.Query("arch"); archFilter != "" {
					baseQuery = baseQuery.Where("arch = ?", archFilter)
				}
				if versionFilter := c.Query("version"); versionFilter != "" {
					baseQuery = baseQuery.Where("version = ?", versionFilter)
				}
				if localeFilter := c.Query("locale"); localeFilter != "" {
					baseQuery = baseQuery.Where("locale = ?", localeFilter)
				}

				var stats StatsResponse

				baseQuery.Count(&stats.TotalUsers)

				onlineThreshold := time.Now().Add(-2 * time.Minute)
				baseQuery.Session(&gorm.Session{}).Where("last_seen_at > ?", onlineThreshold).Count(&stats.OnlineUsers)

				today := time.Now().Format("2006-01-02")
				baseQuery.Session(&gorm.Session{}).Where("date(created_at) = ?", today).Count(&stats.TodayNew)

				dauThreshold := time.Now().Add(-24 * time.Hour)
				baseQuery.Session(&gorm.Session{}).Where("last_seen_at > ?", dauThreshold).Count(&stats.DAU)

				limit := 8
				getDistribution := func(field string) []map[string]any {
					var results []map[string]any
					baseQuery.Session(&gorm.Session{}).Select(field + " as name, count(*) as value").
						Group(field).Order("value desc").Limit(limit).Scan(&results)
					return results
				}

				stats.OSStats = getDistribution("os")
				stats.ArchStats = getDistribution("arch")
				stats.VersionStats = getDistribution("version")
				stats.LocaleStats = getDistribution("locale")
				stats.ScreenStats = getDistribution("screen_res")

				baseQuery.Session(&gorm.Session{}).Raw(`
					SELECT 
						date(created_at) as date, 
						count(*) as count,
						sum(case when date(last_seen_at) = date(created_at) then 1 else 0 end) as new_count
					FROM telemetry_records 
					WHERE created_at > date('now', '-' || ? || ' days')
					`+buildWhereClause(c)+`
					GROUP BY date 
					ORDER BY date ASC
				`, days).Scan(&stats.GrowthData)

				var recentRecs []TelemetryRecord
				baseQuery.Session(&gorm.Session{}).Order("last_seen_at desc").Limit(50).Find(&recentRecs)

				stats.RecentUsers = make([]map[string]any, len(recentRecs))
				for i, r := range recentRecs {
					stats.RecentUsers[i] = map[string]any{
						"id":                r.ID,
						"uid":               r.MachineID,
						"hwid":              r.MachineID,
						"alias":             r.Alias,
						"version":           r.Version,
						"os":                r.OS,
						"os_version":        r.OSVersion,
						"os_build":          r.OSRelease,
						"arch":              r.Arch,
						"screen_resolution": r.ScreenRes,
						"python_version":    r.PythonVersion,
						"locale":            r.Locale,
						"updated_at":        r.LastSeenAt.Format("2006-01-02 15:04:05"),
						"created_at":        r.CreatedAt.Format("2006-01-02 15:04:05"),
						"minutes_ago":       int(time.Since(r.LastSeenAt).Minutes()),
					}
				}

				getAllOptions := func(field string) []map[string]any {
					var results []map[string]any
					db.Model(&TelemetryRecord{}).Select(field + " as name, count(*) as value").
						Group(field).Order("value desc").Scan(&results)
					return results
				}
				stats.OSOptions = getAllOptions("os")
				stats.ArchOptions = getAllOptions("arch")
				stats.VersionOptions = getAllOptions("version")
				stats.LocaleOptions = getAllOptions("locale")

				c.JSON(200, stats)
			})

			admin.GET("/drilldown", func(c *gin.Context) {
				dimension := c.Query("dimension")
				value := c.Query("value")

				var resp DrilldownResponse
				resp.Period = "当前筛选"

				query := db.Model(&TelemetryRecord{})

				if dimension != "" && value != "" && dimension != "date" {
					query = query.Where(dimension+" = ?", value)
				}
				if dimension == "date" && value != "" {
					query = query.Where("date(created_at) = ?", value)
				}

				var users []TelemetryRecord
				query.Order("last_seen_at desc").Limit(100).Find(&users)

				resp.Items = make([]map[string]any, len(users))
				for i, u := range users {
					resp.Items[i] = map[string]any{
						"name":  u.MachineID,
						"value": 1,
						"label": fmt.Sprintf("%s / %s", u.OS, u.Version),
					}
				}
				c.JSON(200, resp)
			})

			admin.GET("/export", func(c *gin.Context) {
				c.Header("Content-Type", "text/csv")
				c.Header("Content-Disposition", "attachment;filename=telemetry_export.csv")

				writer := csv.NewWriter(c.Writer)
				c.Writer.Write([]byte("\xEF\xBB\xBF"))

				headers := []string{"Machine ID", "Version", "OS", "Arch", "Python", "Locale", "Screen", "First Seen", "Last Seen"}
				writer.Write(headers)

				var users []TelemetryRecord
				startDate := c.Query("start_date")
				endDate := c.Query("end_date")

				query := db.Model(&TelemetryRecord{})
				if startDate != "" {
					query = query.Where("date(created_at) >= ?", startDate)
				}
				if endDate != "" {
					query = query.Where("date(created_at) <= ?", endDate)
				}

				query.FindInBatches(&users, 1000, func(tx *gorm.DB, batch int) error {
					for _, u := range users {
						writer.Write([]string{
							u.MachineID,
							u.Version,
							u.OS + " " + u.OSVersion,
							u.Arch,
							u.PythonVersion,
							u.Locale,
							u.ScreenRes,
							u.CreatedAt.Format("2006-01-02 15:04:05"),
							u.LastSeenAt.Format("2006-01-02 15:04:05"),
						})
					}
					writer.Flush()
					return nil
				})
			})

			admin.POST("/control", func(c *gin.Context) {
				var req map[string]any
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}

				action, _ := req["action"].(string)

				switch action {
				case "maintenance":
					if val, ok := req["maintenance"].(bool); ok {
						sysConfig.Maintenance = val
					}
					if val, ok := req["maintenance_msg"].(string); ok {
						sysConfig.MaintenanceMsg = val
					}
					if val, ok := req["stop_new_data"].(bool); ok {
						sysConfig.StopNewData = val
					}

				case "alert":
					if val, ok := req["alert_active"].(bool); ok {
						sysConfig.AlertActive = val
					}
					if val, ok := req["title"].(string); ok {
						sysConfig.AlertTitle = val
					}
					if val, ok := req["content"].(string); ok {
						sysConfig.AlertContent = val
					}
					if val, ok := req["scope"].(string); ok {
						sysConfig.AlertScope = val
					}

				case "notice":
					if val, ok := req["notice_active"].(bool); ok {
						sysConfig.NoticeActive = val
					}
					if val, ok := req["content"].(string); ok {
						sysConfig.NoticeContent = val
					}
					if val, ok := req["scope"].(string); ok {
						sysConfig.NoticeScope = val
					}

				case "update":
					sysConfig.UpdateActive = true
					if val, ok := req["content"].(string); ok {
						sysConfig.UpdateContent = val
					}
					if val, ok := req["url"].(string); ok {
						sysConfig.UpdateUrl = val
					}
					if val, ok := req["scope"].(string); ok {
						sysConfig.UpdateScope = val
					}
				}

				c.JSON(200, gin.H{"status": "success", "config": sysConfig})
			})

			admin.POST("/update-alias", func(c *gin.Context) {
				var req struct {
					MachineID string `json:"machine_id"`
					Alias     string `json:"alias"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}

				if err := db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("alias", req.Alias).Error; err != nil {
					c.JSON(500, gin.H{"error": "Update failed"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})

			admin.POST("/user-command", func(c *gin.Context) {
				var req struct {
					MachineID string `json:"machine_id"`
					Command   string `json:"command"` // JSON string
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}

				err := db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("pending_command", req.Command).Error
				if err != nil {
					c.JSON(500, gin.H{"error": "Update failed"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})

			admin.POST("/delete-user", func(c *gin.Context) {
				var req struct {
					MachineID string `json:"machine_id"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}

				if err := db.Delete(&TelemetryRecord{}, "machine_id = ?", req.MachineID).Error; err != nil {
					c.JSON(500, gin.H{"error": "Delete failed"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})
		}
	}

	r.POST("/telemetry", func(c *gin.Context) {
		if sysConfig.Maintenance && sysConfig.StopNewData {
			c.JSON(503, gin.H{"status": "maintenance", "sys_config": sysConfig})
			return
		}

		var record TelemetryRecord
		if err := c.ShouldBindJSON(&record); err != nil {
			c.JSON(400, gin.H{"error": "Invalid JSON"})
			return
		}

		record.LastSeenAt = time.Now()

		err := db.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "machine_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"version", "os", "os_release", "os_version", "arch",
				"cpu_count", "screen_res", "python_version", "locale", "session_id", "last_seen_at",
			}),
		}).Create(&record).Error

		if err != nil {
			c.JSON(500, gin.H{"status": "error"})
			return
		}

		clientConfig := sysConfig
		if sysConfig.AlertScope != "all" && sysConfig.AlertScope != record.Version {
			clientConfig.AlertActive = false
			clientConfig.AlertTitle = ""
			clientConfig.AlertContent = ""
		}
		if sysConfig.NoticeScope != "all" && sysConfig.NoticeScope != record.Version {
			clientConfig.NoticeActive = false
			clientConfig.NoticeContent = ""
		}
		if sysConfig.UpdateScope != "all" && sysConfig.UpdateScope != record.Version {
			clientConfig.UpdateActive = false
			clientConfig.UpdateContent = ""
			clientConfig.UpdateUrl = ""
		}

		var pendingCmd string
		db.Model(&TelemetryRecord{}).Where("machine_id = ?", record.MachineID).Select("pending_command").Scan(&pendingCmd)
		if pendingCmd != "" {
			db.Model(&TelemetryRecord{}).Where("machine_id = ?", record.MachineID).Update("pending_command", "")
		}

		c.JSON(200, gin.H{
			"status":       "success",
			"sys_config":   clientConfig,
			"user_command": pendingCmd,
		})
	})
}

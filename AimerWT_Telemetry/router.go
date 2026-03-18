package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// matchScope 判断用户是否匹配推送范围，支持 tag:/star/admin 前缀
func matchScope(scope string, record TelemetryRecord) bool {
	if scope == "" || scope == "all" {
		return true
	}
	if scope == "star" {
		return record.IsStarred
	}
	if scope == "admin" {
		return record.IsAdmin
	}
	if strings.HasPrefix(scope, "tag:") {
		tag_name := strings.TrimPrefix(scope, "tag:")
		return strings.Contains(record.Tags, `"`+tag_name+`"`)
	}
	return scope == record.Version
}

func parseBannerItems(raw any) ([]BannerItem, error) {
	if raw == nil {
		return nil, nil
	}
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var items []BannerItem
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func intValue(raw any) (int, bool) {
	switch value := raw.(type) {
	case int:
		return value, true
	case int32:
		return int(value), true
	case int64:
		return int(value), true
	case float32:
		return int(value), true
	case float64:
		return int(value), true
	case json.Number:
		parsed, err := value.Int64()
		if err != nil {
			return 0, false
		}
		return int(parsed), true
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func initRouter(r *gin.Engine) {
	// CORS 中间件：允许 pywebview 前端跨域访问 AI 端点
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-AimerWT-Client")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// 静态文件服务：上传的广告图片
	uploadsDir := "uploads"
	if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
		os.MkdirAll(uploadsDir, 0755)
	}
	r.Static("/uploads", uploadsDir)

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
		if path == "/health" || path == "/ws" {
			c.Next()
			return
		}

		if path == "/telemetry" || path == "/feedback" {
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

	// 静态文件服务
	r.Static("/css", "./dashboard/css")
	r.Static("/js", "./dashboard/js")
	r.Static("/views", "./dashboard/views")

	// 主软件前端文件（供 dashboard 内嵌浏览）
	r.Static("/app", "../web")

	authorized := r.Group("/", authMiddleware)
	{
		authorized.GET("/dashboard", func(c *gin.Context) {
			c.Data(http.StatusOK, "text/html; charset=utf-8", dashboardHTML)
		})

		admin := authorized.Group("/admin")
		{
			admin.GET("/control", func(c *gin.Context) {
				c.JSON(200, gin.H{"status": "success", "config": sysConfig})
			})

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

				onlineThreshold := time.Now().Add(-7 * time.Minute)
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
						"is_starred":        r.IsStarred,
						"is_admin":          r.IsAdmin,
						"tags":              r.Tags,
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

				// 标签选项供前端 scope 选择器使用
				var tagOptions []UserTag
				db.Order("sort_order asc, id asc").Find(&tagOptions)
				stats.TagOptions = tagOptions

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
				shouldPersist := true

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
					if val, ok := req["notice_action_type"].(string); ok {
						sysConfig.NoticeActionType = val
					}
					if val, ok := req["notice_action_url"].(string); ok {
						sysConfig.NoticeActionURL = val
					}
					if val, ok := req["notice_action_title"].(string); ok {
						sysConfig.NoticeActionTitle = val
					}
					if val, ok := req["notice_action_content"].(string); ok {
						sysConfig.NoticeActionContent = val
					}
					if rawItems, exists := req["banner_items"]; exists {
						items, err := parseBannerItems(rawItems)
						if err != nil {
							c.JSON(400, gin.H{"error": "Invalid banner_items"})
							return
						}
						sysConfig.BannerItems = items
					}
					if rawInterval, exists := req["banner_interval"]; exists {
						if interval, ok := intValue(rawInterval); ok && interval > 0 {
							sysConfig.BannerInterval = interval
						}
					}
					if !sysConfig.NoticeActive {
						sysConfig.NoticeContent = ""
						sysConfig.NoticeActionType = ""
						sysConfig.NoticeActionURL = ""
						sysConfig.NoticeActionTitle = ""
						sysConfig.NoticeActionContent = ""
						sysConfig.BannerItems = nil
						sysConfig.BannerInterval = 0
					}

				case "update":
					if val, ok := req["update_active"].(bool); ok {
						sysConfig.UpdateActive = val
					}
					if val, ok := req["content"].(string); ok {
						sysConfig.UpdateContent = val
					}
					if val, ok := req["url"].(string); ok {
						sysConfig.UpdateUrl = val
					}
					if val, ok := req["scope"].(string); ok {
						sysConfig.UpdateScope = val
					}

				case "heartbeat":
					if val, ok := req["heartbeat_interval"].(float64); ok {
						iv := int(val)
						if iv < 10 {
							iv = 10
						}
						if iv > 3600 {
							iv = 3600
						}
						sysConfig.HeartbeatInterval = iv
					}
					if val, ok := req["heartbeat_scope"].(string); ok {
						sysConfig.HeartbeatScope = val
					}

				case "project_info":
					if val, ok := req["project_status"].(string); ok {
						sysConfig.ProjectStatus = val
					}
					if val, ok := req["project_last_update"].(string); ok {
						sysConfig.ProjectLastUpdate = val
					}

				case "_query":
					shouldPersist = false
				default:
					c.JSON(400, gin.H{"error": "Unknown action"})
					return
				}

				// WebSocket 实时推送
				if wsHub != nil {
					switch action {
					case "maintenance":
						BroadcastMaintenance(sysConfig.Maintenance, sysConfig.MaintenanceMsg)
					case "alert":
						if sysConfig.AlertActive {
							BroadcastAlert(sysConfig.AlertTitle, sysConfig.AlertContent, sysConfig.AlertScope)
						}
					case "notice":
						if sysConfig.NoticeActive {
							BroadcastNotice(sysConfig.NoticeContent, sysConfig.NoticeScope)
						}
					case "update":
						if sysConfig.UpdateActive {
							BroadcastUpdate(sysConfig.UpdateContent, sysConfig.UpdateUrl, sysConfig.UpdateScope)
						}
					}
				}

				if shouldPersist {
					// 持久化 sysConfig 到数据库
					PersistSysConfig()
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

			// 广告轮播管理 API
			admin.GET("/ad-carousel", func(c *gin.Context) {
				items := LoadAdCarouselItems()
				c.JSON(200, gin.H{
					"items":       items,
					"interval_ms": LoadAdCarouselInterval(),
				})
			})

			admin.POST("/ad-carousel", func(c *gin.Context) {
				var req struct {
					Items      []AdCarouselItem `json:"items"`
					IntervalMs int              `json:"interval_ms"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}

				SaveAdCarouselItems(req.Items)
				if req.IntervalMs > 0 {
					SaveConfig("ad_carousel_interval_ms", strconv.Itoa(req.IntervalMs))
				}

				c.JSON(200, gin.H{"status": "success", "count": len(req.Items)})
			})

			// 广告图片上传接口（单文件，最大 8MB）
			admin.POST("/upload", func(c *gin.Context) {
				c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
				file, err := c.FormFile("file")
				if err != nil {
					c.JSON(400, gin.H{"error": "文件读取失败: " + err.Error()})
					return
				}

				ext := strings.ToLower(filepath.Ext(file.Filename))
				allowed := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}
				if !allowed[ext] {
					c.JSON(400, gin.H{"error": "不支持的文件类型，仅支持 jpg/png/webp/gif"})
					return
				}

				filename := fmt.Sprintf("ad_%d%s", time.Now().UnixMilli(), ext)
				dstPath := filepath.Join("uploads", filename)
				if err := c.SaveUploadedFile(file, dstPath); err != nil {
					c.JSON(500, gin.H{"error": "文件保存失败: " + err.Error()})
					return
				}

				c.JSON(200, gin.H{"status": "success", "url": "/uploads/" + filename, "filename": filename})
			})

			// 公告列表 CRUD API
			admin.GET("/notices", func(c *gin.Context) {
				var items []NoticeItem
				db.Order("sort_order asc, id desc").Find(&items)
				c.JSON(200, gin.H{"items": items})
			})

			admin.POST("/notices", func(c *gin.Context) {
				var item NoticeItem
				if err := c.ShouldBindJSON(&item); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}
				item.ID = 0
				// 置顶互斥：新记录置顶时取消其他置顶
				if item.IsPinned {
					db.Model(&NoticeItem{}).Where("is_pinned = ?", true).Update("is_pinned", false)
				}
				if err := db.Create(&item).Error; err != nil {
					c.JSON(500, gin.H{"error": "Create failed"})
					return
				}
				c.JSON(200, gin.H{"status": "success", "item": item})
			})

			admin.PUT("/notices/:id", func(c *gin.Context) {
				id := c.Param("id")
				var existing NoticeItem
				if err := db.First(&existing, id).Error; err != nil {
					c.JSON(404, gin.H{"error": "Not found"})
					return
				}
				var updates NoticeItem
				if err := c.ShouldBindJSON(&updates); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}
				if updates.IsPinned {
					db.Model(&NoticeItem{}).Where("is_pinned = ? AND id != ?", true, existing.ID).Update("is_pinned", false)
				}
				db.Model(&existing).Updates(map[string]interface{}{
					"type": updates.Type, "tag": updates.Tag, "title": updates.Title,
					"summary": updates.Summary, "content": updates.Content, "date": updates.Date,
					"is_pinned": updates.IsPinned, "sort_order": updates.SortOrder,
				})
				db.First(&existing, id)
				c.JSON(200, gin.H{"status": "success", "item": existing})
			})

			admin.DELETE("/notices/:id", func(c *gin.Context) {
				id := c.Param("id")
				if err := db.Delete(&NoticeItem{}, id).Error; err != nil {
					c.JSON(500, gin.H{"error": "Delete failed"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})

			// 反馈管理 API (admin)
			admin.GET("/feedback", func(c *gin.Context) {
				query := db.Model(&FeedbackRecord{})

				if status := c.Query("status"); status != "" {
					query = query.Where("status = ?", status)
				}
				if category := c.Query("category"); category != "" {
					query = query.Where("category = ?", category)
				}
				if version := c.Query("version"); version != "" {
					query = query.Where("version = ?", version)
				}
				if keyword := c.Query("keyword"); keyword != "" {
					like := "%" + keyword + "%"
					query = query.Where("content LIKE ? OR contact LIKE ?", like, like)
				}

				var total int64
				query.Count(&total)

				page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
				pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
				if page < 1 {
					page = 1
				}
				if pageSize < 1 || pageSize > 200 {
					pageSize = 50
				}
				offset := (page - 1) * pageSize

				var items []FeedbackRecord
				query.Order("id desc").Offset(offset).Limit(pageSize).Find(&items)

				// 关联用户别名
				result := make([]map[string]any, len(items))
				for i, fb := range items {
					var alias string
					db.Model(&TelemetryRecord{}).Where("machine_id = ?", fb.MachineID).Select("alias").Scan(&alias)
					result[i] = map[string]any{
						"id":         fb.ID,
						"machine_id": fb.MachineID,
						"alias":      alias,
						"version":    fb.Version,
						"contact":    fb.Contact,
						"content":    fb.Content,
						"category":   fb.Category,
						"os":         fb.OS,
						"os_version": fb.OSVersion,
						"screen_res": fb.ScreenRes,
						"locale":     fb.Locale,
						"status":     fb.Status,
						"admin_note": fb.AdminNote,
						"created_at": fb.CreatedAt.Format("2006-01-02 15:04:05"),
						"updated_at": fb.UpdatedAt.Format("2006-01-02 15:04:05"),
					}
				}

				// 统计概览
				var pendingCount, todayCount int64
				db.Model(&FeedbackRecord{}).Where("status = 'pending'").Count(&pendingCount)
				today := time.Now().Format("2006-01-02")
				db.Model(&FeedbackRecord{}).Where("date(created_at) = ?", today).Count(&todayCount)

				c.JSON(200, gin.H{
					"items":         result,
					"total":         total,
					"page":          page,
					"page_size":     pageSize,
					"pending_count": pendingCount,
					"today_count":   todayCount,
				})
			})

			admin.PUT("/feedback/:id", func(c *gin.Context) {
				id := c.Param("id")
				var existing FeedbackRecord
				if err := db.First(&existing, id).Error; err != nil {
					c.JSON(404, gin.H{"error": "Not found"})
					return
				}
				var req struct {
					Status    string `json:"status"`
					AdminNote string `json:"admin_note"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "Invalid JSON"})
					return
				}
				updates := map[string]interface{}{}
				if req.Status != "" {
					updates["status"] = req.Status
				}
				if req.AdminNote != "" {
					updates["admin_note"] = req.AdminNote
				}
				if len(updates) > 0 {
					db.Model(&existing).Updates(updates)
				}
				db.First(&existing, id)
				c.JSON(200, gin.H{"status": "success", "item": existing})
			})

			admin.DELETE("/feedback/:id", func(c *gin.Context) {
				id := c.Param("id")
				if err := db.Delete(&FeedbackRecord{}, id).Error; err != nil {
					c.JSON(500, gin.H{"error": "Delete failed"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})
		}

		// AI 代理管理路由
		initAIRoutes(admin)

		// ==================== 标签管理 API ====================

		admin.GET("/tags", func(c *gin.Context) {
			var tags []UserTag
			db.Order("sort_order asc, id asc").Find(&tags)
			c.JSON(200, gin.H{"tags": tags})
		})

		admin.POST("/tags", func(c *gin.Context) {
			var tag UserTag
			if err := c.ShouldBindJSON(&tag); err != nil {
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}
			tag.ID = 0
			tag.IsSystem = false
			if tag.Name == "" {
				c.JSON(400, gin.H{"error": "name is required"})
				return
			}
			var count int64
			db.Model(&UserTag{}).Where("name = ?", tag.Name).Count(&count)
			if count > 0 {
				c.JSON(409, gin.H{"error": "tag name already exists"})
				return
			}
			if err := db.Create(&tag).Error; err != nil {
				c.JSON(500, gin.H{"error": "Create failed"})
				return
			}
			c.JSON(200, gin.H{"status": "success", "tag": tag})
		})

		admin.PUT("/tags/:id", func(c *gin.Context) {
			id := c.Param("id")
			var existing UserTag
			if err := db.First(&existing, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Not found"})
				return
			}
			var updates UserTag
			if err := c.ShouldBindJSON(&updates); err != nil {
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}
			updateMap := map[string]interface{}{}
			if updates.DisplayName != "" {
				updateMap["display_name"] = updates.DisplayName
			}
			if updates.Color != "" {
				updateMap["color"] = updates.Color
			}
			if updates.Icon != "" {
				updateMap["icon"] = updates.Icon
			}
			if updates.SortOrder != 0 {
				updateMap["sort_order"] = updates.SortOrder
			}
			if !existing.IsSystem && updates.Name != "" {
				updateMap["name"] = updates.Name
			}
			if len(updateMap) > 0 {
				db.Model(&existing).Updates(updateMap)
			}
			db.First(&existing, id)
			c.JSON(200, gin.H{"status": "success", "tag": existing})
		})

		admin.DELETE("/tags/:id", func(c *gin.Context) {
			id := c.Param("id")
			var tag UserTag
			if err := db.First(&tag, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "Not found"})
				return
			}
			if tag.IsSystem {
				c.JSON(403, gin.H{"error": "系统内置标签不可删除"})
				return
			}
			db.Delete(&tag)
			c.JSON(200, gin.H{"status": "success"})
		})

		// ==================== 用户标签操作 API ====================

		admin.POST("/user-tags", func(c *gin.Context) {
			var req struct {
				MachineID string   `json:"machine_id"`
				Tags      []string `json:"tags"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}
			tagsJson, _ := json.Marshal(req.Tags)
			if err := db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("tags", string(tagsJson)).Error; err != nil {
				c.JSON(500, gin.H{"error": "Update failed"})
				return
			}
			c.JSON(200, gin.H{"status": "success"})
		})

		admin.POST("/user-star", func(c *gin.Context) {
			var req struct {
				MachineID string `json:"machine_id"`
				IsStarred bool   `json:"is_starred"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}
			if err := db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("is_starred", req.IsStarred).Error; err != nil {
				c.JSON(500, gin.H{"error": "Update failed"})
				return
			}
			c.JSON(200, gin.H{"status": "success"})
		})

		admin.POST("/user-admin", func(c *gin.Context) {
			var req struct {
				MachineID string `json:"machine_id"`
				IsAdmin   bool   `json:"is_admin"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}
			if err := db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("is_admin", req.IsAdmin).Error; err != nil {
				c.JSON(500, gin.H{"error": "Update failed"})
				return
			}
			c.JSON(200, gin.H{"status": "success"})
		})
	}

	// 客户端 AI 聊天端点（支持 UA 或自定义 header 校验，不需要 Basic Auth）
	r.POST("/api/ai/chat", func(c *gin.Context) {
		ua := c.GetHeader("User-Agent")
		clientHeader := c.GetHeader("X-AimerWT-Client")
		uaOk := len(ua) >= 14 && ua[:14] == "AimerWT-Client"
		headerOk := clientHeader != ""
		if !uaOk && !headerOk {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied"})
			return
		}
		handleAIChat(c)
	})

	// 客户端反馈提交（使用与 /telemetry 相同的 UA 校验）
	r.POST("/feedback", func(c *gin.Context) {
		var fb FeedbackRecord
		if err := c.ShouldBindJSON(&fb); err != nil {
			c.JSON(400, gin.H{"error": "Invalid JSON"})
			return
		}

		// 内容校验
		if len(fb.Content) == 0 {
			c.JSON(400, gin.H{"error": "Content is required"})
			return
		}
		if len(fb.Content) > 500 {
			fb.Content = fb.Content[:500]
		}
		if len(fb.Contact) > 100 {
			fb.Contact = fb.Contact[:100]
		}

		// 频率限制：同一 machine_id 5 分钟内最多 1 条
		if fb.MachineID != "" {
			var recentCount int64
			threshold := time.Now().Add(-5 * time.Minute)
			db.Model(&FeedbackRecord{}).Where("machine_id = ? AND created_at > ?", fb.MachineID, threshold).Count(&recentCount)
			if recentCount > 0 {
				c.JSON(429, gin.H{"error": "请稍后再提交反馈（5分钟内限1条）"})
				return
			}
		}

		fb.Status = "pending"
		if err := db.Create(&fb).Error; err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(200, gin.H{"status": "success", "feedback_id": fb.ID})
	})

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

		// 查询当前用户的持久化标签数据，用于 scope 匹配
		var dbRecord TelemetryRecord
		db.Where("machine_id = ?", record.MachineID).First(&dbRecord)

		if !matchScope(sysConfig.AlertScope, dbRecord) {
			clientConfig.AlertActive = false
			clientConfig.AlertTitle = ""
			clientConfig.AlertContent = ""
		}
		if !matchScope(sysConfig.NoticeScope, dbRecord) {
			clientConfig.NoticeActive = false
			clientConfig.NoticeContent = ""
		}
		if !matchScope(sysConfig.UpdateScope, dbRecord) {
			clientConfig.UpdateActive = false
			clientConfig.UpdateContent = ""
			clientConfig.UpdateUrl = ""
		}
		if sysConfig.HeartbeatScope != "" && !matchScope(sysConfig.HeartbeatScope, dbRecord) {
			clientConfig.HeartbeatInterval = 0
		}

		var pendingCmd string
		var userSeqID uint
		db.Model(&TelemetryRecord{}).Where("machine_id = ?", record.MachineID).Select("pending_command").Scan(&pendingCmd)
		db.Model(&TelemetryRecord{}).Where("machine_id = ?", record.MachineID).Select("id").Scan(&userSeqID)
		if pendingCmd != "" {
			db.Model(&TelemetryRecord{}).Where("machine_id = ?", record.MachineID).Update("pending_command", "")
		}

		response := gin.H{
			"status":       "success",
			"sys_config":   clientConfig,
			"user_command": pendingCmd,
			"user_seq_id":  userSeqID,
		}

		// 构建广告轮播数据供客户端同步（图片路径补全为完整 URL）
		if adItemsRaw := LoadConfig("ad_carousel_items"); adItemsRaw != "" {
			items := LoadAdCarouselItems()
			scheme := "http"
			if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
				scheme = "https"
			}
			baseURL := scheme + "://" + c.Request.Host
			for i := range items {
				if len(items[i].Image) > 0 && items[i].Image[0] == '/' {
					items[i].Image = baseURL + items[i].Image
				}
			}
			adJson, _ := json.Marshal(items)
			var parsed interface{}
			json.Unmarshal(adJson, &parsed)
			response["ad_carousel_items"] = parsed
			response["ad_carousel_interval_ms"] = LoadAdCarouselInterval()
		}

		// 构建公告列表数据供客户端同步
		var noticeItems []NoticeItem
		db.Order("sort_order asc, id desc").Find(&noticeItems)
		response["notice_items"] = noticeItems

		c.JSON(200, response)
	})

	// WebSocket 端点（不需要 Basic Auth，使用自定义认证）
	r.GET("/ws", HandleWebSocket)
}

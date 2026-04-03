package main

import (
	"crypto/subtle"
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

func serializeTelemetryUser(record TelemetryRecord) map[string]any {
	row := serializeTelemetryUserBase(record)
	profiles := loadUserProfilesMap([]string{record.MachineID})
	attachTelemetryUserProfile(row, profiles[record.MachineID])
	return row
}

func serializeTelemetryUserBase(record TelemetryRecord) map[string]any {
	return map[string]any{
		"id":                record.ID,
		"uid":               record.MachineID,
		"hwid":              record.MachineID,
		"machine_id":        record.MachineID,
		"alias":             record.Alias,
		"version":           record.Version,
		"os":                record.OS,
		"os_version":        record.OSVersion,
		"os_build":          record.OSRelease,
		"arch":              record.Arch,
		"screen_resolution": record.ScreenRes,
		"python_version":    record.PythonVersion,
		"locale":            record.Locale,
		"is_starred":        record.IsStarred,
		"is_admin":          record.IsAdmin,
		"tags":              record.Tags,
		"comment_perms":     record.CommentPerms,
		"updated_at":        record.LastSeenAt.Format("2006-01-02 15:04:05"),
		"created_at":        record.CreatedAt.Format("2006-01-02 15:04:05"),
		"minutes_ago":       int(time.Since(record.LastSeenAt).Minutes()),
	}
}

func attachTelemetryUserProfile(row map[string]any, profile UserProfile) {
	if profile.MachineID != "" {
		row["level"] = profile.Level
		row["exp"] = profile.Exp
		row["nickname"] = profile.Nickname
		row["bound_qq"] = profile.BoundQQ
		row["has_bound_qq"] = strings.TrimSpace(profile.BoundQQ) != ""
		row["badges"] = profile.Badges
		row["verified"] = profile.Verified
		return
	}
	row["level"] = 0
	row["exp"] = 0
	row["nickname"] = ""
	row["bound_qq"] = ""
	row["has_bound_qq"] = false
	row["badges"] = "[]"
	row["verified"] = false
}

func serializeTelemetryUsers(records []TelemetryRecord) []map[string]any {
	if len(records) == 0 {
		return []map[string]any{}
	}

	machineIDs := make([]string, 0, len(records))
	for _, record := range records {
		machineIDs = append(machineIDs, record.MachineID)
	}
	profiles := loadUserProfilesMap(machineIDs)

	result := make([]map[string]any, len(records))
	for i, record := range records {
		row := serializeTelemetryUserBase(record)
		attachTelemetryUserProfile(row, profiles[record.MachineID])
		result[i] = row
	}
	return result
}

func updateTelemetryUserFields(machineID string, updates map[string]any) (TelemetryRecord, error) {
	machineID = strings.TrimSpace(machineID)
	if machineID == "" {
		return TelemetryRecord{}, gorm.ErrRecordNotFound
	}

	tx := db.Model(&TelemetryRecord{}).Where("machine_id = ?", machineID).Updates(updates)
	if tx.Error != nil {
		return TelemetryRecord{}, tx.Error
	}
	if tx.RowsAffected == 0 {
		return TelemetryRecord{}, gorm.ErrRecordNotFound
	}

	var updated TelemetryRecord
	if err := db.Where("machine_id = ?", machineID).First(&updated).Error; err != nil {
		return TelemetryRecord{}, err
	}
	return updated, nil
}

func initRouter(r *gin.Engine) {
	// CORS 中间件：允许 pywebview 前端跨域访问 AI 端点
	r.Use(func(c *gin.Context) {
		if !applyCORSHeaders(c) {
			return
		}
		c.Next()
	})

	applyClientNoStoreHeaders := func(c *gin.Context) {
		c.Header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		c.Header("Pragma", "no-cache")
		c.Header("Expires", "0")
	}

	r.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/telemetry" ||
			path == "/feedback" ||
			path == "/redeem" ||
			path == "/user-profile" ||
			path == "/notice-reaction" ||
			path == "/notice-comment" ||
			path == "/notice-comment-like" ||
			path == "/notice-comment-report" ||
			path == "/latest-version" ||
			strings.HasPrefix(path, "/api/ai/") ||
			strings.HasPrefix(path, "/notice-comments/") ||
			strings.HasPrefix(path, "/notice-reactions/") {
			applyClientNoStoreHeaders(c)
		}
		c.Next()
	})

	// 静态文件服务：上传的广告图片
	uploadsDir := "uploads"
	if _, err := os.Stat(uploadsDir); os.IsNotExist(err) {
		os.MkdirAll(uploadsDir, 0755)
	}
	r.Static("/uploads", uploadsDir)

	isValidAdminBasicAuth := func(req *http.Request) bool {
		user, pass, hasAuth := req.BasicAuth()
		return hasAuth &&
			subtle.ConstantTimeCompare([]byte(user), []byte(adminUser)) == 1 &&
			subtle.ConstantTimeCompare([]byte(pass), []byte(adminPass)) == 1
	}

	authMiddleware := func(c *gin.Context) {
		if isValidAdminBasicAuth(c.Request) {
			c.Next()
			return
		}

		c.Header("WWW-Authenticate", "Basic realm=\"Telemetry Admin\"")
		c.AbortWithStatus(http.StatusUnauthorized)
	}

	r.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		if path == "/health" || path == "/ws" || c.Request.Method == "OPTIONS" {
			c.Next()
			return
		}

		protectedClientPaths := map[string]bool{
			"/telemetry":           true,
			"/feedback":            true,
			"/redeem":              true,
			"/telemetry/ad-click":  true,
			"/user-profile":        true,
			"/api/ai/chat":         true,
			"/api/ai/stats":        true,
			"/api/ai/quota":        true,
			"/notice-reaction":     true,
			"/notice-comment":      true,
			"/notice-comment-like": true,
		}
		protectedByPrefix := strings.HasPrefix(path, "/notice-comments/") || strings.HasPrefix(path, "/notice-reactions/")
		if protectedClientPaths[path] || protectedByPrefix {
			if isValidAdminBasicAuth(c.Request) {
				c.Next()
				return
			}
			if !requireClientRequest(c) {
				return
			}
			if queryMachineID := strings.TrimSpace(c.Query("machine_id")); queryMachineID != "" {
				if !ensureClientMachineBinding(c, queryMachineID) {
					return
				}
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
	r.Static("/redeem", "./dashboard/redeem")

	// 主软件前端文件（供 dashboard 内嵌浏览）
	r.Static("/app", "../web")

	authorized := r.Group("/", authMiddleware)
	{
		authorized.GET("/dashboard", func(c *gin.Context) {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.Header("Pragma", "no-cache")
			c.Data(http.StatusOK, "text/html; charset=utf-8", dashboardHTML)
		})

		admin := authorized.Group("/admin")
		admin.Use(func(c *gin.Context) {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.Header("Pragma", "no-cache")
			c.Next()
		})
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
				onlineThresholdMinutes, _ := strconv.Atoi(c.DefaultQuery("online_threshold_min", "0"))
				if onlineThresholdMinutes <= 0 {
					onlineThresholdMinutes = sysConfig.OnlineThresholdMin
				}
				if onlineThresholdMinutes <= 0 {
					onlineThresholdMinutes = 5
				}
				if onlineThresholdMinutes > 120 {
					onlineThresholdMinutes = 120
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

				onlineThreshold := time.Now().Add(-time.Duration(onlineThresholdMinutes) * time.Minute)
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

				stats.RecentUsers = serializeTelemetryUsers(recentRecs)

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
				dimensionColumns := map[string]string{
					"os":         "os",
					"arch":       "arch",
					"version":    "version",
					"locale":     "locale",
					"screen_res": "screen_res",
					"date":       "date",
				}

				if dimension != "" {
					if _, ok := dimensionColumns[dimension]; !ok {
						c.JSON(400, gin.H{"error": "不支持的维度"})
						return
					}
				}

				var resp DrilldownResponse
				resp.Period = "当前筛选"

				query := db.Model(&TelemetryRecord{})

				if dimension != "" && value != "" && dimension != "date" {
					query = query.Where(dimensionColumns[dimension]+" = ?", value)
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

			admin.GET("/user", func(c *gin.Context) {
				machineID := strings.TrimSpace(c.Query("machine_id"))
				if machineID == "" {
					c.JSON(400, gin.H{"error": "缺少 machine_id"})
					return
				}

				var user TelemetryRecord
				if err := db.Where("machine_id = ?", machineID).First(&user).Error; err != nil {
					if err == gorm.ErrRecordNotFound {
						c.JSON(404, gin.H{"error": "用户不存在"})
						return
					}
					c.JSON(500, gin.H{"error": "查询失败"})
					return
				}

				c.JSON(200, gin.H{"user": serializeTelemetryUser(user)})
			})

			admin.GET("/users", func(c *gin.Context) {
				offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
				limit, _ := strconv.Atoi(c.DefaultQuery("limit", "500"))
				if offset < 0 {
					offset = 0
				}
				if limit <= 0 {
					limit = 500
				}
				if limit > 1000 {
					limit = 1000
				}

				baseQuery := db.Model(&TelemetryRecord{})

				var total int64
				if err := baseQuery.Count(&total).Error; err != nil {
					c.JSON(500, gin.H{"error": "统计用户数量失败"})
					return
				}

				var users []TelemetryRecord
				if err := baseQuery.Order("last_seen_at desc, id desc").Offset(offset).Limit(limit).Find(&users).Error; err != nil {
					c.JSON(500, gin.H{"error": "加载用户列表失败"})
					return
				}

				nextOffset := offset + len(users)
				c.JSON(200, gin.H{
					"users":       serializeTelemetryUsers(users),
					"total":       total,
					"offset":      offset,
					"limit":       limit,
					"next_offset": nextOffset,
					"has_more":    int64(nextOffset) < total,
				})
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
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
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
							c.JSON(400, gin.H{"error": "横幅数据格式无效"})
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

				case "online_threshold":
					if val, ok := req["online_threshold_min"].(float64); ok {
						iv := int(val)
						if iv < 1 {
							iv = 1
						}
						if iv > 120 {
							iv = 120
						}
						sysConfig.OnlineThresholdMin = iv
					}

				case "project_info":
					if val, ok := req["project_status"].(string); ok {
						sysConfig.ProjectStatus = val
					}
					if val, ok := req["project_last_update"].(string); ok {
						sysConfig.ProjectLastUpdate = val
					}

				case "user_features":
					if val, ok := req["badge_system_enabled"].(bool); ok {
						sysConfig.BadgeSystemEnabled = val
					}
					if val, ok := req["nickname_change_enabled"].(bool); ok {
						sysConfig.NicknameChangeEnabled = val
					}
					if val, ok := req["avatar_upload_enabled"].(bool); ok {
						sysConfig.AvatarUploadEnabled = val
					}
					if val, ok := req["notice_comment_enabled"].(bool); ok {
						sysConfig.NoticeCommentEnabled = val
					}
					if val, ok := req["notice_reaction_enabled"].(bool); ok {
						sysConfig.NoticeReactionEnabled = val
					}
					if val, ok := req["redeem_code_enabled"].(bool); ok {
						sysConfig.RedeemCodeEnabled = val
					}
					if val, ok := req["feedback_enabled"].(bool); ok {
						sysConfig.FeedbackEnabled = val
					}
					if val, ok := req["avatar_upload_allow_all"].(bool); ok {
						sysConfig.AvatarUploadAllowAll = val
					}
					if val, ok := req["avatar_upload_allowed_tags"]; ok {
						if tagsJSON, err := json.Marshal(val); err == nil {
							sysConfig.AvatarUploadAllowedTags = string(tagsJSON)
						}
					}

				case "latest_version":
					if val, ok := req["version"].(string); ok {
						SaveConfig("latest_version", val)
					}
					if val, ok := req["download_url"].(string); ok {
						SaveConfig("latest_version_url", val)
					}
					if val, ok := req["changelog"].(string); ok {
						SaveConfig("latest_version_changelog", val)
					}
					shouldPersist = false

				case "_query":
					shouldPersist = false
				default:
					c.JSON(400, gin.H{"error": "未知操作"})
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
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}
				req.MachineID = strings.TrimSpace(req.MachineID)
				req.Alias = strings.TrimSpace(req.Alias)
				if req.MachineID == "" {
					c.JSON(400, gin.H{"error": "machine_id 为必填"})
					return
				}

				updatedUser, err := updateTelemetryUserFields(req.MachineID, map[string]any{
					"alias": req.Alias,
				})
				if err != nil {
					if err == gorm.ErrRecordNotFound {
						c.JSON(404, gin.H{"error": "用户不存在"})
						return
					}
					c.JSON(500, gin.H{"error": "更新失败"})
					return
				}
				c.JSON(200, gin.H{"status": "success", "user": serializeTelemetryUser(updatedUser)})
			})

			admin.POST("/user-command", func(c *gin.Context) {
				var req struct {
					MachineID string `json:"machine_id"`
					Command   string `json:"command"` // JSON string
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}

				err := db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("pending_command", req.Command).Error
				if err != nil {
					c.JSON(500, gin.H{"error": "更新失败"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})

			admin.POST("/delete-user", func(c *gin.Context) {
				var req struct {
					MachineID string `json:"machine_id"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}

				if err := db.Delete(&TelemetryRecord{}, "machine_id = ?", req.MachineID).Error; err != nil {
					c.JSON(500, gin.H{"error": "删除失败"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})

			// 批量删除用户（传入 machine_id 数组）
			admin.POST("/delete-users", func(c *gin.Context) {
				var req struct {
					MachineIDs []string `json:"machine_ids"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}
				if len(req.MachineIDs) == 0 {
					c.JSON(400, gin.H{"error": "machine_ids 不能为空"})
					return
				}
				if len(req.MachineIDs) > 100 {
					c.JSON(400, gin.H{"error": "一次最多删除 100 个用户"})
					return
				}
				if err := db.Delete(&TelemetryRecord{}, "machine_id IN ?", req.MachineIDs).Error; err != nil {
					c.JSON(500, gin.H{"error": "批量删除失败"})
					return
				}
				c.JSON(200, gin.H{"status": "success", "deleted": len(req.MachineIDs)})
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
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
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

			// 信息库广告位管理 API
			admin.GET("/knowledge-ads", func(c *gin.Context) {
				raw := LoadKnowledgeAdsConfig()
				if raw == "" {
					c.JSON(200, gin.H{"items": []any{}})
					return
				}
				var parsed map[string]any
				if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
					c.JSON(200, gin.H{"items": []any{}})
					return
				}
				c.JSON(200, parsed)
			})

			admin.POST("/knowledge-ads", func(c *gin.Context) {
				var body json.RawMessage
				if err := c.ShouldBindJSON(&body); err != nil {
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}
				SaveKnowledgeAdsConfig(string(body))
				c.JSON(200, gin.H{"status": "success"})
			})

			admin.POST("/knowledge-ads/upload", func(c *gin.Context) {
				c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 5<<20)
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
				slotID := c.PostForm("slot_id")
				imgType := c.PostForm("type")
				filename := fmt.Sprintf("kb_%s_%s_%d%s", slotID, imgType, time.Now().UnixMilli(), ext)
				dstPath := filepath.Join("uploads", filename)
				if err := c.SaveUploadedFile(file, dstPath); err != nil {
					c.JSON(500, gin.H{"error": "文件保存失败: " + err.Error()})
					return
				}
				c.JSON(200, gin.H{"status": "success", "url": "/uploads/" + filename})
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
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}
				item.ID = 0
				// 置顶互斥：新记录置顶时取消其他置顶
				if item.IsPinned {
					db.Model(&NoticeItem{}).Where("is_pinned = ?", true).Update("is_pinned", false)
				}
				if err := db.Create(&item).Error; err != nil {
					c.JSON(500, gin.H{"error": "创建失败"})
					return
				}
				c.JSON(200, gin.H{"status": "success", "item": item})
			})

			admin.PUT("/notices/:id", func(c *gin.Context) {
				id := c.Param("id")
				var existing NoticeItem
				if err := db.First(&existing, id).Error; err != nil {
					c.JSON(404, gin.H{"error": "未找到"})
					return
				}
				var updates NoticeItem
				if err := c.ShouldBindJSON(&updates); err != nil {
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}
				if updates.IsPinned {
					db.Model(&NoticeItem{}).Where("is_pinned = ? AND id != ?", true, existing.ID).Update("is_pinned", false)
				}
				db.Model(&existing).Updates(map[string]interface{}{
					"type": updates.Type, "tag": updates.Tag, "title": updates.Title,
					"summary": updates.Summary, "content": updates.Content, "date": updates.Date,
					"is_pinned": updates.IsPinned, "icon_class": updates.IconClass, "sort_order": updates.SortOrder,
				})
				db.First(&existing, id)
				c.JSON(200, gin.H{"status": "success", "item": existing})
			})

			admin.DELETE("/notices/:id", func(c *gin.Context) {
				id := c.Param("id")
				if err := db.Delete(&NoticeItem{}, id).Error; err != nil {
					c.JSON(500, gin.H{"error": "删除失败"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})

			// 公告反应管理 API (admin)
			admin.GET("/notice-reactions/:notice_id", func(c *gin.Context) {
				noticeID := c.Param("notice_id")
				var reactions []NoticeReaction
				db.Where("notice_id = ?", noticeID).Order("created_at asc").Find(&reactions)

				// 按 emoji 分组统计
				type reactionGroup struct {
					Emoji string   `json:"emoji"`
					Count int      `json:"count"`
					Users []string `json:"users"`
				}
				groupMap := map[string]*reactionGroup{}
				var order []string
				for _, r := range reactions {
					g, ok := groupMap[r.Emoji]
					if !ok {
						g = &reactionGroup{Emoji: r.Emoji}
						groupMap[r.Emoji] = g
						order = append(order, r.Emoji)
					}
					g.Count++
					g.Users = append(g.Users, r.MachineID)
				}
				result := make([]reactionGroup, 0, len(order))
				for _, emoji := range order {
					result = append(result, *groupMap[emoji])
				}
				c.JSON(200, gin.H{"reactions": result})
			})

			// 表情权限管理 API (admin)
			admin.GET("/emoji-permissions", func(c *gin.Context) {
				var cfg ContentConfig
				result := db.Where("key = ?", "emoji_permissions").First(&cfg)
				if result.Error != nil {
					c.JSON(200, gin.H{"permissions": map[string]interface{}{}})
					return
				}
				var parsed interface{}
				if err := json.Unmarshal([]byte(cfg.Value), &parsed); err != nil {
					c.JSON(200, gin.H{"permissions": map[string]interface{}{}})
					return
				}
				c.JSON(200, gin.H{"permissions": parsed})
			})

			admin.POST("/emoji-permissions", func(c *gin.Context) {
				var req struct {
					Permissions interface{} `json:"permissions"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
					return
				}
				data, err := json.Marshal(req.Permissions)
				if err != nil {
					c.JSON(400, gin.H{"error": "数据无效"})
					return
				}
				SaveConfig("emoji_permissions", string(data))
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
					c.JSON(404, gin.H{"error": "未找到"})
					return
				}
				var req struct {
					Status    string `json:"status"`
					AdminNote string `json:"admin_note"`
				}
				if err := c.ShouldBindJSON(&req); err != nil {
					c.JSON(400, gin.H{"error": "请求数据格式错误"})
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
					c.JSON(500, gin.H{"error": "删除失败"})
					return
				}
				c.JSON(200, gin.H{"status": "success"})
			})
		}

		initAIRoutes(admin)

		// 兑换码管理路由
		initRedeemRoutes(admin)

		// 社区评论管理路由
		initCommunityAdminRoutes(admin)

		// 评论权重配置路由
		initCommentWeightRoutes(admin)

		// ==================== 广告统计 API ====================

		admin.GET("/ad-stats", func(c *gin.Context) {
			rangeDays := c.DefaultQuery("days", "30")
			days, _ := strconv.Atoi(rangeDays)
			if days <= 0 {
				days = 30
			}

			mediumFilter := c.Query("medium")

			baseQuery := db.Model(&AdClickEvent{}).Where("created_at > date('now', '-' || ? || ' days')", days)
			if mediumFilter != "" {
				baseQuery = baseQuery.Where("ad_medium = ?", mediumFilter)
			}

			// 总点击数
			var totalClicks int64
			baseQuery.Session(&gorm.Session{}).Count(&totalClicks)

			// 今日点击
			var todayClicks int64
			today := time.Now().Format("2006-01-02")
			baseQuery.Session(&gorm.Session{}).Where("date(created_at) = ?", today).Count(&todayClicks)

			// 独立用户数
			var uniqueUsers int64
			baseQuery.Session(&gorm.Session{}).Distinct("machine_id").Count(&uniqueUsers)

			// 平均日点击
			avgDaily := float64(0)
			if days > 0 && totalClicks > 0 {
				avgDaily = float64(totalClicks) / float64(days)
			}

			// 每日点击趋势
			var dailyClicks []map[string]any
			baseQuery.Session(&gorm.Session{}).
				Select("date(created_at) as date, count(*) as count").
				Group("date(created_at)").Order("date ASC").
				Scan(&dailyClicks)

			// Top N 广告素材
			var topAds []map[string]any
			baseQuery.Session(&gorm.Session{}).
				Select("ad_id as name, ad_medium as medium, count(*) as value").
				Group("ad_id, ad_medium").Order("value DESC").Limit(10).
				Scan(&topAds)

			// 按广告位分布
			var mediumDist []map[string]any
			baseQuery.Session(&gorm.Session{}).
				Select("ad_medium as name, count(*) as value").
				Group("ad_medium").Order("value DESC").
				Scan(&mediumDist)

			// 最近 50 条点击记录
			var recentClicks []AdClickEvent
			q := db.Model(&AdClickEvent{}).Order("created_at DESC").Limit(50)
			if mediumFilter != "" {
				q = q.Where("ad_medium = ?", mediumFilter)
			}
			q.Find(&recentClicks)

			recentList := make([]map[string]any, len(recentClicks))
			for i, ev := range recentClicks {
				// 尝试关联用户别名
				var alias string
				db.Model(&TelemetryRecord{}).Where("machine_id = ?", ev.MachineID).Select("alias").Scan(&alias)
				recentList[i] = map[string]any{
					"id":         ev.ID,
					"machine_id": ev.MachineID,
					"alias":      alias,
					"ad_medium":  ev.AdMedium,
					"ad_id":      ev.AdID,
					"target_url": ev.TargetURL,
					"created_at": ev.CreatedAt.Format("2006-01-02 15:04:05"),
				}
			}

			c.JSON(200, gin.H{
				"summary": gin.H{
					"total_clicks": totalClicks,
					"today_clicks": todayClicks,
					"unique_users": uniqueUsers,
					"avg_daily":    fmt.Sprintf("%.1f", avgDaily),
				},
				"daily_clicks":        dailyClicks,
				"top_ads":             topAds,
				"medium_distribution": mediumDist,
				"recent_clicks":       recentList,
			})
		})

		// ==================== 标签管理 API ====================

		admin.GET("/tags", func(c *gin.Context) {
			var tags []UserTag
			db.Order("sort_order asc, id asc").Find(&tags)
			c.JSON(200, gin.H{"tags": tags})
		})

		admin.POST("/tags", func(c *gin.Context) {
			var tag UserTag
			if err := c.ShouldBindJSON(&tag); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}
			tag.ID = 0
			tag.IsSystem = false
			if tag.Name == "" {
				c.JSON(400, gin.H{"error": "标签名称不能为空"})
				return
			}
			var count int64
			db.Model(&UserTag{}).Where("name = ?", tag.Name).Count(&count)
			if count > 0 {
				c.JSON(409, gin.H{"error": "标签名称已存在"})
				return
			}
			if err := db.Create(&tag).Error; err != nil {
				c.JSON(500, gin.H{"error": "创建失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success", "tag": tag})
		})

		admin.PUT("/tags/:id", func(c *gin.Context) {
			id := c.Param("id")
			var existing UserTag
			if err := db.First(&existing, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "未找到"})
				return
			}
			var updates UserTag
			if err := c.ShouldBindJSON(&updates); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
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
				c.JSON(404, gin.H{"error": "未找到"})
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
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}
			req.MachineID = strings.TrimSpace(req.MachineID)
			if req.MachineID == "" {
				c.JSON(400, gin.H{"error": "machine_id 为必填"})
				return
			}
			tagsJson, _ := json.Marshal(req.Tags)
			updatedUser, err := updateTelemetryUserFields(req.MachineID, map[string]any{
				"tags": string(tagsJson),
			})
			if err != nil {
				if err == gorm.ErrRecordNotFound {
					c.JSON(404, gin.H{"error": "用户不存在"})
					return
				}
				c.JSON(500, gin.H{"error": "更新失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success", "user": serializeTelemetryUser(updatedUser)})
		})

		admin.POST("/user-star", func(c *gin.Context) {
			var req struct {
				MachineID string `json:"machine_id"`
				IsStarred bool   `json:"is_starred"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}
			req.MachineID = strings.TrimSpace(req.MachineID)
			if req.MachineID == "" {
				c.JSON(400, gin.H{"error": "machine_id 为必填"})
				return
			}
			updatedUser, err := updateTelemetryUserFields(req.MachineID, map[string]any{
				"is_starred": req.IsStarred,
			})
			if err != nil {
				if err == gorm.ErrRecordNotFound {
					c.JSON(404, gin.H{"error": "用户不存在"})
					return
				}
				c.JSON(500, gin.H{"error": "更新失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success", "user": serializeTelemetryUser(updatedUser)})
		})

		admin.POST("/user-admin", func(c *gin.Context) {
			var req struct {
				MachineID string `json:"machine_id"`
				IsAdmin   bool   `json:"is_admin"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}
			req.MachineID = strings.TrimSpace(req.MachineID)
			if req.MachineID == "" {
				c.JSON(400, gin.H{"error": "machine_id 为必填"})
				return
			}
			updatedUser, err := updateTelemetryUserFields(req.MachineID, map[string]any{
				"is_admin": req.IsAdmin,
			})
			if err != nil {
				if err == gorm.ErrRecordNotFound {
					c.JSON(404, gin.H{"error": "用户不存在"})
					return
				}
				c.JSON(500, gin.H{"error": "更新失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success", "user": serializeTelemetryUser(updatedUser)})
		})

		// 用户评论区权限管理
		admin.GET("/user-comment-perms", func(c *gin.Context) {
			machineID := c.Query("machine_id")
			if machineID == "" {
				c.JSON(400, gin.H{"error": "machine_id 为必填"})
				return
			}
			var record TelemetryRecord
			if err := db.Select("comment_perms").Where("machine_id = ?", machineID).First(&record).Error; err != nil {
				c.JSON(200, gin.H{"comment_perms": map[string]bool{}})
				return
			}
			var perms map[string]bool
			if record.CommentPerms == "" || record.CommentPerms == "{}" {
				perms = map[string]bool{}
			} else if err := json.Unmarshal([]byte(record.CommentPerms), &perms); err != nil {
				perms = map[string]bool{}
			}
			c.JSON(200, gin.H{"comment_perms": perms})
		})

		admin.POST("/user-comment-perms", func(c *gin.Context) {
			var req struct {
				MachineID    string          `json:"machine_id"`
				CommentPerms map[string]bool `json:"comment_perms"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}
			data, err := json.Marshal(req.CommentPerms)
			if err != nil {
				c.JSON(400, gin.H{"error": "数据无效"})
				return
			}
			if err := db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("comment_perms", string(data)).Error; err != nil {
				c.JSON(500, gin.H{"error": "更新失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success"})
		})

		// 用户个人资料管理员路由
		initUserProfileAdminRoutes(admin)
	}

	// 客户端 AI 聊天端点（支持 UA 或自定义 header 校验，不需要 Basic Auth）
	r.POST("/api/ai/chat", func(c *gin.Context) {
		ua := c.GetHeader("User-Agent")
		clientHeader := c.GetHeader("X-AimerWT-Client")
		uaOk := len(ua) >= 14 && ua[:14] == "AimerWT-Client"
		headerOk := clientHeader != ""
		if !uaOk && !headerOk {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "访问被拒绝"})
			return
		}
		handleAIChat(c)
	})

	// 客户端 AI 统计端点（全服务器 Token 总消耗，脱敏数据）
	r.GET("/api/ai/stats", handleAIStats)

	// 客户端 AI 限额查询端点（返回用户剩余次数）
	r.GET("/api/ai/quota", handleAIQuota)

	// 客户端版本检测：返回管理员配置的最新发布版本号
	r.GET("/latest-version", func(c *gin.Context) {
		version := LoadConfig("latest_version")
		downloadUrl := LoadConfig("latest_version_url")
		changelog := LoadConfig("latest_version_changelog")
		c.JSON(200, gin.H{
			"latest_version": version,
			"download_url":   downloadUrl,
			"changelog":      changelog,
		})
	})

	// 客户端兑换码提交（使用与 /telemetry 相同的 UA 校验）
	r.POST("/redeem", handleRedeem)

	// 客户端反馈提交（使用与 /telemetry 相同的 UA 校验）
	r.POST("/feedback", handleFeedback)

	// 公告表情反应 API（客户端调用）
	r.POST("/notice-reaction", func(c *gin.Context) {
		if !sysConfig.NoticeReactionEnabled {
			c.JSON(403, gin.H{"error": "公告表情互动已关闭"})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req struct {
			NoticeID  uint   `json:"notice_id"`
			MachineID string `json:"machine_id"`
			Emoji     string `json:"emoji"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}
		req.MachineID = strings.TrimSpace(req.MachineID)
		req.Emoji = strings.TrimSpace(req.Emoji)
		if req.NoticeID == 0 || req.Emoji == "" || req.MachineID == "" {
			c.JSON(400, gin.H{"error": "notice_id、machine_id、emoji 为必填"})
			return
		}

		var actor TelemetryRecord
		db.Select("is_admin").Where("machine_id = ?", req.MachineID).First(&actor)

		if !actor.IsAdmin {
			status := "added"
			if err := db.Transaction(func(tx *gorm.DB) error {
				var existingReactions []NoticeReaction
				if err := tx.Select("id", "emoji").
					Where("notice_id = ? AND machine_id = ?", req.NoticeID, req.MachineID).
					Find(&existingReactions).Error; err != nil {
					return err
				}

				hasSameEmoji := false
				for _, reaction := range existingReactions {
					if reaction.Emoji == req.Emoji {
						hasSameEmoji = true
						break
					}
				}

				if len(existingReactions) > 0 {
					if err := tx.Where("notice_id = ? AND machine_id = ?", req.NoticeID, req.MachineID).
						Delete(&NoticeReaction{}).Error; err != nil {
						return err
					}
				}

				if hasSameEmoji {
					status = "removed"
					return nil
				}
				if len(existingReactions) > 0 {
					status = "replaced"
				}

				return tx.Create(&NoticeReaction{
					NoticeID:  req.NoticeID,
					MachineID: req.MachineID,
					Emoji:     req.Emoji,
				}).Error
			}); err != nil {
				c.JSON(500, gin.H{"error": "保存失败"})
				return
			}
			c.JSON(200, gin.H{"status": status})
			return
		}

		var existing NoticeReaction
		if err := db.Where("notice_id = ? AND machine_id = ? AND emoji = ?", req.NoticeID, req.MachineID, req.Emoji).First(&existing).Error; err == nil {
			db.Delete(&existing)
			c.JSON(200, gin.H{"status": "removed"})
			return
		}

		newReaction := NoticeReaction{
			NoticeID:  req.NoticeID,
			MachineID: req.MachineID,
			Emoji:     req.Emoji,
		}
		if err := db.Create(&newReaction).Error; err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(200, gin.H{"status": "added"})
	})

	r.GET("/notice-reactions/:notice_id", func(c *gin.Context) {
		if !sysConfig.NoticeReactionEnabled {
			c.JSON(200, gin.H{"reactions": []map[string]any{}, "disabled": true})
			return
		}
		noticeID := c.Param("notice_id")
		machineID := c.Query("machine_id")

		var reactions []NoticeReaction
		db.Where("notice_id = ?", noticeID).Order("created_at asc").Find(&reactions)

		// 收集所有参与的 MachineID，批量查询对应的 user_seq_id（TelemetryRecord.ID）
		machineIDs := map[string]bool{}
		for _, r := range reactions {
			machineIDs[r.MachineID] = true
		}
		type identityRow struct {
			MachineID string
			ID        uint
			Alias     string
			Nickname  string
		}
		var identityRows []identityRow
		if len(machineIDs) > 0 {
			keys := make([]string, 0, len(machineIDs))
			for k := range machineIDs {
				keys = append(keys, k)
			}
			db.Table("telemetry_records AS tr").
				Select("tr.machine_id, tr.id, tr.alias, COALESCE(up.nickname, '') AS nickname").
				Joins("LEFT JOIN user_profiles AS up ON up.machine_id = tr.machine_id").
				Where("tr.machine_id IN ?", keys).
				Scan(&identityRows)
		}
		seqMap := map[string]uint{}
		aliasMap := map[string]string{}
		nicknameMap := map[string]string{}
		for _, row := range identityRows {
			seqMap[row.MachineID] = row.ID
			aliasMap[row.MachineID] = row.Alias
			nicknameMap[row.MachineID] = row.Nickname
		}

		type reactionItem struct {
			Emoji       string              `json:"emoji"`
			Count       int                 `json:"count"`
			Users       []string            `json:"users"`
			UserDetails []map[string]string `json:"user_details,omitempty"`
			Reacted     bool                `json:"reacted"`
		}
		groupMap := map[string]*reactionItem{}
		var order []string
		for _, r := range reactions {
			g, ok := groupMap[r.Emoji]
			if !ok {
				g = &reactionItem{Emoji: r.Emoji}
				groupMap[r.Emoji] = g
				order = append(order, r.Emoji)
			}
			g.Count++
			// 使用数字序号 ID 代替 MachineID 哈希
			uid := "?"
			if seqID, exists := seqMap[r.MachineID]; exists {
				uid = fmt.Sprintf("%d", seqID)
			}
			g.Users = append(g.Users, uid)
			userDetail := map[string]string{"uid": uid}
			if nickname := strings.TrimSpace(nicknameMap[r.MachineID]); nickname != "" {
				userDetail["nickname"] = nickname
			}
			if alias := strings.TrimSpace(aliasMap[r.MachineID]); alias != "" {
				userDetail["alias"] = alias
			}
			g.UserDetails = append(g.UserDetails, userDetail)
			if r.MachineID == machineID {
				g.Reacted = true
			}
		}
		result := make([]reactionItem, 0, len(order))
		for _, emoji := range order {
			result = append(result, *groupMap[emoji])
		}
		c.JSON(200, gin.H{"reactions": result})
	})

	// 广告点击上报（客户端直接调用，不需要 admin 认证）
	r.POST("/telemetry/ad-click", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			MachineID string `json:"machine_id"`
			AdMedium  string `json:"ad_medium"`
			AdID      string `json:"ad_id"`
			TargetURL string `json:"target_url"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if req.AdMedium == "" || req.AdID == "" {
			c.JSON(400, gin.H{"error": "ad_medium 和 ad_id 为必填"})
			return
		}
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}
		// 字段长度限制
		if len(req.MachineID) > 64 {
			req.MachineID = req.MachineID[:64]
		}
		if len(req.AdMedium) > 32 {
			req.AdMedium = req.AdMedium[:32]
		}
		if len(req.AdID) > 64 {
			req.AdID = req.AdID[:64]
		}
		if len(req.TargetURL) > 2048 {
			req.TargetURL = req.TargetURL[:2048]
		}

		// 去重：同一用户 + 同一广告 2 分钟内只记录 1 次
		if req.MachineID != "" {
			var recentCount int64
			threshold := time.Now().Add(-2 * time.Minute)
			db.Model(&AdClickEvent{}).
				Where("machine_id = ? AND ad_id = ? AND created_at > ?", req.MachineID, req.AdID, threshold).
				Count(&recentCount)
			if recentCount > 0 {
				c.JSON(200, gin.H{"status": "deduplicated"})
				return
			}
		}

		event := AdClickEvent{
			MachineID: req.MachineID,
			AdMedium:  req.AdMedium,
			AdID:      req.AdID,
			TargetURL: req.TargetURL,
		}
		if err := db.Create(&event).Error; err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(200, gin.H{"status": "success"})
	})

	r.POST("/telemetry", func(c *gin.Context) {
		if sysConfig.Maintenance && sysConfig.StopNewData {
			c.JSON(503, gin.H{"status": "maintenance", "sys_config": sysConfig})
			return
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var record TelemetryRecord
		if err := c.ShouldBindJSON(&record); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if !ensureClientMachineBinding(c, record.MachineID) {
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

		var dbRecord TelemetryRecord
		if err := db.Select("id", "version", "pending_command", "is_starred", "is_admin", "tags").
			Where("machine_id = ?", record.MachineID).
			First(&dbRecord).Error; err != nil {
			dbRecord = record
		}

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

		pendingCmd := dbRecord.PendingCommand
		userSeqID := dbRecord.ID
		if pendingCmd != "" {
			db.Model(&TelemetryRecord{}).Where("machine_id = ?", record.MachineID).Update("pending_command", "")
		}

		response := gin.H{
			"status":       "success",
			"sys_config":   clientConfig,
			"user_command": pendingCmd,
			"user_seq_id":  userSeqID,
		}
		// 统一 token 签发：首次引导或 token 失效重签均走此路径，
		// issueClientDeviceToken 内部使用 Upsert 保证幂等。
		needIssue := !hasClientDeviceToken(record.MachineID)
		if _, renew := c.Get("_deviceTokenRenew"); renew {
			needIssue = true
		}
		if needIssue {
			deviceToken, err := issueClientDeviceToken(record.MachineID)
			if err != nil {
				c.JSON(500, gin.H{"status": "error", "error": "设备令牌签发失败"})
				return
			}
			c.Header(clientDeviceTokenHeader, deviceToken)
			response["client_device_token"] = deviceToken
		}

		// 构建广告轮播数据供客户端同步（图片路径补全为完整 URL）
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
		adJSON, _ := json.Marshal(items)
		var parsed interface{}
		json.Unmarshal(adJSON, &parsed)
		response["ad_carousel_items"] = parsed
		response["ad_carousel_interval_ms"] = LoadAdCarouselInterval()

		// 信息库广告位数据下发
		kbRaw := LoadKnowledgeAdsConfig()
		if kbRaw != "" {
			var kbParsed map[string]interface{}
			if err := json.Unmarshal([]byte(kbRaw), &kbParsed); err == nil {
				// 补全图片路径
				if kbItems, ok := kbParsed["items"].([]interface{}); ok {
					for _, raw := range kbItems {
						if m, ok := raw.(map[string]interface{}); ok {
							for _, field := range []string{"avatar", "background"} {
								if v, ok := m[field].(string); ok && len(v) > 0 && v[0] == '/' {
									m[field] = baseURL + v
								}
							}
						}
					}
				}
				response["knowledge_ads_items"] = kbParsed
			}
		}

		// 构建公告列表数据供客户端同步
		var noticeItems []NoticeItem
		db.Order("sort_order asc, id desc").Find(&noticeItems)
		response["notice_items"] = noticeItems

		// 公告反应摘要（emoji + count，不含用户列表）
		type reactionSummary struct {
			NoticeID uint   `json:"notice_id"`
			Emoji    string `json:"emoji"`
			Count    int64  `json:"count"`
		}
		var rawSummaries []reactionSummary
		db.Model(&NoticeReaction{}).Select("notice_id, emoji, count(*) as count").Group("notice_id, emoji").Scan(&rawSummaries)
		response["notice_reactions"] = rawSummaries

		c.JSON(200, response)
	})

	// 用户个人资料客户端公开路由
	initUserProfileClientRoutes(r)

	// 社区评论客户端路由（公开端点，使用 UA/HMAC 校验）
	initCommunityClientRoutes(r)

	// 合规审计日志路由（仪表盘内访问，暂不需要认证）
	initAuditLogRoutes(r)

	// WebSocket 端点（不需要 Basic Auth，使用自定义认证）
	r.GET("/ws", HandleWebSocket)
}

func handleFeedback(c *gin.Context) {
	if !sysConfig.FeedbackEnabled {
		c.JSON(403, gin.H{"error": "问题反馈功能已关闭"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
	var fb FeedbackRecord
	if err := c.ShouldBindJSON(&fb); err != nil {
		c.JSON(400, gin.H{"error": "请求数据格式错误"})
		return
	}
	if !ensureClientMachineBinding(c, fb.MachineID) {
		return
	}

	// 内容校验
	if len(fb.Content) == 0 {
		c.JSON(400, gin.H{"error": "内容不能为空"})
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
}

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── AI 配置（持久化到 ContentConfig 表） ───

type AIProxyConfig struct {
	Enabled      bool    `json:"enabled"`
	Provider     string  `json:"provider"`      // 标记用途（zhipu / deepseek / openai / relay 等）
	ApiUrl       string  `json:"api_url"`        // OpenAI 兼容的 chat/completions 端点
	ApiKey       string  `json:"api_key"`        // 持久化到数据库的 API Key（优先级高于环境变量）
	Model        string  `json:"model"`          // 模型名称，自由填写
	SystemPrompt string  `json:"system_prompt"`
	MaxTokens    int     `json:"max_tokens"`
	Temperature  float64 `json:"temperature"`
	HourlyLimit  int     `json:"hourly_limit"` // 全局默认每小时限额
	MaxHistory   int     `json:"max_history"`  // 最大历史对话条数
}

var aiConfig AIProxyConfig
var aiEnvKey string // 环境变量 AI_API_KEY，作为回退

// getEffectiveApiKey 获取当前生效的 API Key（数据库配置 > 环境变量）
func getEffectiveApiKey() string {
	if aiConfig.ApiKey != "" {
		return aiConfig.ApiKey
	}
	return aiEnvKey
}

// 默认AI配置
func defaultAIConfig() AIProxyConfig {
	return AIProxyConfig{
		Enabled:      true,
		Provider:     "zhipu",
		ApiUrl:       "https://open.bigmodel.cn/api/paas/v4/chat/completions",
		Model:        "glm-4.7-flash",
		SystemPrompt: "你是小艾米，AimerWT 软件的专属 AI 助手。AimerWT 是一款战争雷霆游戏辅助工具，提供语音包管理、涂装管理、炮镜管理等功能。\n\n回复要求：\n- 使用中文回复\n- 语气亲切可爱，适当使用颜文字\n- 技术问题给出具体解决步骤\n- 不确定时诚实告知\n- 拒绝回答政治敏感话题",
		MaxTokens:    2048,
		Temperature:  0.7,
		HourlyLimit:  20,
		MaxHistory:   30,
	}
}

// 加载AI配置
func LoadAIConfig() {
	raw := LoadConfig("ai_proxy_config")
	if raw == "" {
		aiConfig = defaultAIConfig()
		SaveAIConfig()
		return
	}
	if err := json.Unmarshal([]byte(raw), &aiConfig); err != nil {
		log.Printf("[AI] 解析配置失败，使用默认值: %v", err)
		aiConfig = defaultAIConfig()
	}
}

// 保存AI配置
func SaveAIConfig() {
	data, _ := json.Marshal(aiConfig)
	SaveConfig("ai_proxy_config", string(data))
}

// ─── 速率限制（内存计数器） ───

type rateLimiter struct {
	mu       sync.Mutex
	counters map[string][]time.Time // machine_id -> 请求时间戳列表
}

var limiter = &rateLimiter{
	counters: make(map[string][]time.Time),
}

// 检查速率限制，返回是否允许
func (rl *rateLimiter) Allow(machineID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	oneHourAgo := now.Add(-1 * time.Hour)

	// 清理过期记录
	timestamps := rl.counters[machineID]
	valid := timestamps[:0]
	for _, t := range timestamps {
		if t.After(oneHourAgo) {
			valid = append(valid, t)
		}
	}
	rl.counters[machineID] = valid

	// 获取该用户的限额
	limit := rl.getUserLimit(machineID)

	if len(valid) >= limit {
		return false
	}

	rl.counters[machineID] = append(valid, now)
	return true
}

// 获取用户剩余次数
func (rl *rateLimiter) Remaining(machineID string) int {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	oneHourAgo := now.Add(-1 * time.Hour)

	count := 0
	for _, t := range rl.counters[machineID] {
		if t.After(oneHourAgo) {
			count++
		}
	}

	limit := rl.getUserLimit(machineID)
	remaining := limit - count
	if remaining < 0 {
		remaining = 0
	}
	return remaining
}

// 获取用户的速率限制（优先个人设置，否则全局默认）
func (rl *rateLimiter) getUserLimit(machineID string) int {
	var userLimit AIUserLimit
	if err := db.Where("machine_id = ?", machineID).First(&userLimit).Error; err == nil {
		return userLimit.HourlyLimit
	}
	return aiConfig.HourlyLimit
}

// ─── 封禁检查 ───

func isUserBanned(machineID string) bool {
	var count int64
	db.Model(&AIUserBan{}).Where("machine_id = ?", machineID).Count(&count)
	return count > 0
}

// ─── 客户端请求结构 ───

type AIChatRequest struct {
	MachineID string                   `json:"machine_id"`
	Messages  []map[string]interface{} `json:"messages"`
	Context   map[string]interface{}   `json:"context"`
}

// ─── SSE 流式转发 handler ───

func handleAIChat(c *gin.Context) {
	if !aiConfig.Enabled {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "AI 功能已关闭"})
		return
	}

	if getEffectiveApiKey() == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "AI 服务未配置"})
		return
	}

	var req AIChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求格式错误"})
		return
	}

	if req.MachineID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少设备标识"})
		return
	}

	// 封禁检查
	if isUserBanned(req.MachineID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "AI 功能已被限制"})
		return
	}

	// 速率检查
	if !limiter.Allow(req.MachineID) {
		remaining := limiter.Remaining(req.MachineID)
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error":     "请求过于频繁，请稍后再试",
			"remaining": remaining,
		})
		return
	}

	// 构建消息：系统提示词 + 裁剪后的历史 + 客户端上下文
	messages := buildProxyMessages(req)

	// 调用上游 AI API（SSE 转发）
	streamToClient(c, messages, req.MachineID)
}

// 构建完整的消息数组
func buildProxyMessages(req AIChatRequest) []map[string]interface{} {
	var messages []map[string]interface{}

	// 系统提示词（服务端）
	systemPrompt := aiConfig.SystemPrompt

	// 拼接客户端上下文
	if ctx, ok := req.Context["page"]; ok && ctx != nil {
		if pageStr, ok := ctx.(string); ok && pageStr != "" {
			systemPrompt += "\n\n=== 当前页面信息 ===\n" + pageStr
		}
	}
	if ctx, ok := req.Context["logs"]; ok && ctx != nil {
		if logsStr, ok := ctx.(string); ok && logsStr != "" {
			systemPrompt += "\n\n=== 最近软件日志 ===\n" + logsStr
		}
	}

	messages = append(messages, map[string]interface{}{
		"role":    "system",
		"content": systemPrompt,
	})

	// 裁剪历史对话（最多 maxHistory 条）
	history := req.Messages
	maxHistory := aiConfig.MaxHistory
	if maxHistory <= 0 {
		maxHistory = 30
	}
	if len(history) > maxHistory {
		history = history[len(history)-maxHistory:]
	}

	messages = append(messages, history...)
	return messages
}

// SSE 流式转发
func streamToClient(c *gin.Context, messages []map[string]interface{}, machineID string) {
	// 构建上游请求体
	reqBody := map[string]interface{}{
		"model":       aiConfig.Model,
		"messages":    messages,
		"stream":      true,
		"temperature": aiConfig.Temperature,
		"max_tokens":  aiConfig.MaxTokens,
	}

	bodyBytes, _ := json.Marshal(reqBody)

	upstreamReq, err := http.NewRequest("POST", aiConfig.ApiUrl, bytes.NewReader(bodyBytes))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "构建请求失败"})
		return
	}

	upstreamReq.Header.Set("Content-Type", "application/json")
	upstreamReq.Header.Set("Authorization", "Bearer "+getEffectiveApiKey())

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(upstreamReq)
	if err != nil {
		log.Printf("[AI] 上游请求失败: %v", err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI 服务暂时不可用"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[AI] 上游返回错误 %d: %s", resp.StatusCode, string(body))
		c.JSON(resp.StatusCode, gin.H{"error": "AI 服务返回错误", "detail": string(body)})
		return
	}

	// 设置 SSE 响应头
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "不支持流式输出"})
		return
	}

	// 逐行读取上游 SSE 并转发
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 64*1024)

	var totalPromptTokens, totalCompletionTokens int

	for scanner.Scan() {
		line := scanner.Text()

		// 直接转发 SSE 行
		if strings.HasPrefix(line, "data: ") {
			data := line[6:]

			// 解析以提取 usage 统计
			if data != "[DONE]" {
				var chunk map[string]interface{}
				if err := json.Unmarshal([]byte(data), &chunk); err == nil {
					if usage, ok := chunk["usage"].(map[string]interface{}); ok {
						if pt, ok := usage["prompt_tokens"].(float64); ok {
							totalPromptTokens = int(pt)
						}
						if ct, ok := usage["completion_tokens"].(float64); ok {
							totalCompletionTokens = int(ct)
						}
					}
				}
			}

			fmt.Fprintf(c.Writer, "data: %s\n\n", data)
			flusher.Flush()
		} else if line == "" {
			// SSE 空行分隔符
			continue
		}
	}

	// 记录用量
	if totalPromptTokens > 0 || totalCompletionTokens > 0 {
		log.Printf("[AI] 用量统计 - 用户: %s, 输入: %d, 输出: %d, 总计: %d",
			machineID, totalPromptTokens, totalCompletionTokens, totalPromptTokens+totalCompletionTokens)
		usage := AIUsageRecord{
			MachineID:        machineID,
			Model:            aiConfig.Model,
			PromptTokens:     totalPromptTokens,
			CompletionTokens: totalCompletionTokens,
			TotalTokens:      totalPromptTokens + totalCompletionTokens,
		}
		db.Create(&usage)
	} else {
		log.Printf("[AI] 警告: 流式响应未包含 usage 数据 (用户: %s)", machineID)
	}
}

// ─── 仪表盘管理 API ───

func initAIRoutes(admin *gin.RouterGroup) {
	ai := admin.Group("/ai")
	{
		// 获取 AI 配置
		ai.GET("/config", func(c *gin.Context) {
			// 返回配置（API Key 只返回掩码，不返回明文）
			configCopy := aiConfig
			configCopy.ApiKey = "" // 不在 GET 响应中泄露明文 Key

			effectiveKey := getEffectiveApiKey()
			maskedKey := ""
			if effectiveKey != "" {
				if len(effectiveKey) > 8 {
					maskedKey = effectiveKey[:4] + "****" + effectiveKey[len(effectiveKey)-4:]
				} else {
					maskedKey = "****"
				}
			}

			// Key 来源标记：dashboard（仪表盘配置）/ env（环境变量）/ none
			keySource := "none"
			if aiConfig.ApiKey != "" {
				keySource = "dashboard"
			} else if aiEnvKey != "" {
				keySource = "env"
			}

			c.JSON(200, gin.H{
				"config":      configCopy,
				"api_key":     maskedKey,
				"has_api_key": effectiveKey != "",
				"key_source":  keySource,
			})
		})

		// 保存 AI 配置
		ai.POST("/config", func(c *gin.Context) {
			var req AIProxyConfig
			if err := c.ShouldBindJSON(&req); err != nil {
				log.Printf("[AI] 配置解析失败: %v", err)
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}

			// API Key 处理：客户端传了新 Key 则用新的，未传（空字符串）则保留旧值
			// 清空 Key 使用独立的 /config/clear-key 接口
			oldKey := aiConfig.ApiKey
			aiConfig = req
			if aiConfig.ApiKey == "" {
				aiConfig.ApiKey = oldKey
			}

			SaveAIConfig()
			keySource := "none"
			if aiConfig.ApiKey != "" {
				keySource = "dashboard"
			} else if aiEnvKey != "" {
				keySource = "env"
			}
			log.Printf("[AI] 配置已更新 (提供商: %s, 模型: %s, Key来源: %s)", aiConfig.Provider, aiConfig.Model, keySource)
			c.JSON(200, gin.H{"status": "success"})
		})

		// 清空仪表盘配置的 API Key（回退到环境变量）
		ai.POST("/config/clear-key", func(c *gin.Context) {
			aiConfig.ApiKey = ""
			SaveAIConfig()
			log.Printf("[AI] 已清空仪表盘 API Key，当前使用: %s",
				func() string {
					if aiEnvKey != "" {
						return "环境变量"
					}
					return "无"
				}())
			c.JSON(200, gin.H{"status": "success"})
		})

		// 测试 API 连通性（管理后台专用）
		ai.POST("/test-connection", func(c *gin.Context) {
			effKey := getEffectiveApiKey()
			if effKey == "" {
				c.JSON(200, gin.H{"status": "no_key", "message": "未配置 API Key（仪表盘和环境变量均未设置）"})
				return
			}

			// 发送一个极简请求测试连通
			reqBody := map[string]interface{}{
				"model":      aiConfig.Model,
				"messages":   []map[string]string{{"role": "user", "content": "Hi"}},
				"max_tokens": 1,
				"stream":     false,
			}
			bodyBytes, _ := json.Marshal(reqBody)

			req, _ := http.NewRequest("POST", aiConfig.ApiUrl, bytes.NewReader(bodyBytes))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+effKey)

			client := &http.Client{Timeout: 15 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				c.JSON(200, gin.H{"status": "error", "message": "连接失败: " + err.Error()})
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode == 200 {
				c.JSON(200, gin.H{"status": "ok", "message": fmt.Sprintf("连接正常 (模型: %s)", aiConfig.Model)})
			} else {
				body, _ := io.ReadAll(resp.Body)
				c.JSON(200, gin.H{"status": "error", "message": fmt.Sprintf("上游返回 %d", resp.StatusCode), "detail": string(body)})
			}
		})

		// 用量统计
		ai.GET("/usage", func(c *gin.Context) {
			days := c.DefaultQuery("days", "30")

			// 总计
			var totalRequests int64
			var totalTokens struct{ Total int }
			db.Model(&AIUsageRecord{}).Count(&totalRequests)
			db.Model(&AIUsageRecord{}).Select("COALESCE(SUM(total_tokens), 0) as total").Scan(&totalTokens)

			// 今日
			today := time.Now().Format("2006-01-02")
			var todayRequests int64
			var todayTokens struct{ Total int }
			db.Model(&AIUsageRecord{}).Where("date(created_at) = ?", today).Count(&todayRequests)
			db.Model(&AIUsageRecord{}).Where("date(created_at) = ?", today).Select("COALESCE(SUM(total_tokens), 0) as total").Scan(&todayTokens)

			// 活跃用户数
			var activeUsers int64
			db.Model(&AIUsageRecord{}).Distinct("machine_id").Count(&activeUsers)

			// 趋势数据
			var trend []map[string]interface{}
			db.Model(&AIUsageRecord{}).
				Select("date(created_at) as date, count(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, count(distinct machine_id) as users").
				Where("created_at > date('now', '-' || ? || ' days')", days).
				Group("date(created_at)").
				Order("date ASC").
				Scan(&trend)

			// 用户排行
			var userRanking []map[string]interface{}
			db.Model(&AIUsageRecord{}).
				Select("machine_id, count(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens, MAX(created_at) as last_used").
				Group("machine_id").
				Order("requests DESC").
				Limit(50).
				Scan(&userRanking)

			// 模型使用分布
			var modelDistribution []map[string]interface{}
			db.Model(&AIUsageRecord{}).
				Select("model, count(*) as requests, COALESCE(SUM(total_tokens), 0) as tokens").
				Group("model").
				Order("requests DESC").
				Scan(&modelDistribution)

			// 关联别名和封禁状态
			for i, u := range userRanking {
				var mid string
				switch v := u["machine_id"].(type) {
				case string:
					mid = v
				case []byte:
					mid = string(v)
				default:
					continue
				}
				var alias string
				db.Model(&TelemetryRecord{}).Where("machine_id = ?", mid).Select("alias").Scan(&alias)
				userRanking[i]["alias"] = alias
				userRanking[i]["banned"] = isUserBanned(mid)

				// 获取单用户限额
				var ul AIUserLimit
				if err := db.Where("machine_id = ?", mid).First(&ul).Error; err == nil {
					userRanking[i]["custom_limit"] = ul.HourlyLimit
				}
			}

			c.JSON(200, gin.H{
				"total_requests":     totalRequests,
				"total_tokens":       totalTokens.Total,
				"today_requests":     todayRequests,
				"today_tokens":       todayTokens.Total,
				"active_users":       activeUsers,
				"trend":              trend,
				"user_ranking":       userRanking,
				"model_distribution": modelDistribution,
			})
		})

		// 封禁列表
		ai.GET("/bans", func(c *gin.Context) {
			var bans []AIUserBan
			db.Order("created_at DESC").Find(&bans)

			result := make([]map[string]interface{}, len(bans))
			for i, b := range bans {
				var alias string
				db.Model(&TelemetryRecord{}).Where("machine_id = ?", b.MachineID).Select("alias").Scan(&alias)
				result[i] = map[string]interface{}{
					"id":         b.ID,
					"machine_id": b.MachineID,
					"alias":      alias,
					"reason":     b.Reason,
					"created_at": b.CreatedAt.Format("2006-01-02 15:04:05"),
				}
			}
			c.JSON(200, gin.H{"bans": result})
		})

		// 添加封禁
		ai.POST("/bans", func(c *gin.Context) {
			var req struct {
				MachineID string `json:"machine_id"`
				Reason    string `json:"reason"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}
			ban := AIUserBan{MachineID: req.MachineID, Reason: req.Reason}
			if err := db.Create(&ban).Error; err != nil {
				c.JSON(500, gin.H{"error": "已在封禁列表中或保存失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success", "ban": ban})
		})

		// 解除封禁
		ai.DELETE("/bans/:id", func(c *gin.Context) {
			id := c.Param("id")
			if err := db.Delete(&AIUserBan{}, id).Error; err != nil {
				c.JSON(500, gin.H{"error": "Delete failed"})
				return
			}
			c.JSON(200, gin.H{"status": "success"})
		})

		// 设置单用户限额
		ai.POST("/user-limit", func(c *gin.Context) {
			var req struct {
				MachineID   string `json:"machine_id"`
				HourlyLimit int    `json:"hourly_limit"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "Invalid JSON"})
				return
			}

			if req.HourlyLimit <= 0 {
				// 删除自定义限额，回退到全局默认
				db.Where("machine_id = ?", req.MachineID).Delete(&AIUserLimit{})
				c.JSON(200, gin.H{"status": "success", "message": "已恢复默认限额"})
				return
			}

			var existing AIUserLimit
			if err := db.Where("machine_id = ?", req.MachineID).First(&existing).Error; err != nil {
				existing = AIUserLimit{MachineID: req.MachineID, HourlyLimit: req.HourlyLimit}
				db.Create(&existing)
			} else {
				db.Model(&existing).Update("hourly_limit", req.HourlyLimit)
			}
			c.JSON(200, gin.H{"status": "success"})
		})

		// 删除单用户限额
		ai.DELETE("/user-limit/:machine_id", func(c *gin.Context) {
			mid := c.Param("machine_id")
			db.Where("machine_id = ?", mid).Delete(&AIUserLimit{})
			c.JSON(200, gin.H{"status": "success"})
		})
	}
}

// ─── 客户端公开 API（不需要 admin 认证） ───

// handleAIStats 返回全服务器 AI Token 总消耗（脱敏数据）
func handleAIStats(c *gin.Context) {
	var totalTokens struct{ Total int }
	db.Model(&AIUsageRecord{}).Select("COALESCE(SUM(total_tokens), 0) as total").Scan(&totalTokens)

	var totalRequests int64
	db.Model(&AIUsageRecord{}).Count(&totalRequests)

	c.JSON(200, gin.H{
		"total_tokens":   totalTokens.Total,
		"total_requests": totalRequests,
	})
}

// handleAIQuota 返回指定用户的当前剩余次数和限额信息
func handleAIQuota(c *gin.Context) {
	machineID := c.Query("machine_id")
	if machineID == "" {
		c.JSON(400, gin.H{"error": "缺少 machine_id"})
		return
	}

	remaining := limiter.Remaining(machineID)
	limit := limiter.getUserLimit(machineID)

	c.JSON(200, gin.H{
		"remaining": remaining,
		"limit":     limit,
	})
}

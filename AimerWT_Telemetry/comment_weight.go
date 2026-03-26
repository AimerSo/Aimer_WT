package main

import (
	"encoding/json"
	"math"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	commentWeightConfigKey    = "comment_weight_config"
	defaultBaseCommentWeight  = 1.0
	defaultCommentLikeWeight  = 0.5
	defaultCommentReplyWeight = 0.5
	defaultCommentAuthorBase  = 1.0
	defaultCommentCharLimit   = 200
	defaultWeightValueMin     = -100.0
	defaultWeightValueMax     = 100.0
	defaultCommentLimitMin    = 1
	defaultCommentLimitMax    = 5000
)

type CommentWeightConfig struct {
	BaseUserWeight       float64            `json:"base_user_weight"`
	StarredUserWeight    float64            `json:"starred_user_weight"`
	AdminUserWeight      float64            `json:"admin_user_weight"`
	BaseUserCommentLimit int                `json:"base_user_comment_limit"`
	StarredCommentLimit  int                `json:"starred_comment_limit"`
	AdminCommentLimit    int                `json:"admin_comment_limit"`
	TagWeights           map[string]float64 `json:"tag_weights"`
}

func defaultCommentWeightConfig() CommentWeightConfig {
	return CommentWeightConfig{
		BaseUserWeight:       defaultCommentAuthorBase,
		StarredUserWeight:    0,
		AdminUserWeight:      0,
		BaseUserCommentLimit: defaultCommentCharLimit,
		StarredCommentLimit:  defaultCommentCharLimit,
		AdminCommentLimit:    defaultCommentCharLimit,
		TagWeights:           map[string]float64{},
	}
}

func normalizeCommentWeightValue(value float64, fallback float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	if value < defaultWeightValueMin {
		return defaultWeightValueMin
	}
	if value > defaultWeightValueMax {
		return defaultWeightValueMax
	}
	return math.Round(value*100) / 100
}

func normalizeCommentWeightConfig(cfg CommentWeightConfig) CommentWeightConfig {
	defaults := defaultCommentWeightConfig()
	cfg.BaseUserWeight = normalizeCommentWeightValue(cfg.BaseUserWeight, defaults.BaseUserWeight)
	cfg.StarredUserWeight = normalizeCommentWeightValue(cfg.StarredUserWeight, defaults.StarredUserWeight)
	cfg.AdminUserWeight = normalizeCommentWeightValue(cfg.AdminUserWeight, defaults.AdminUserWeight)
	cfg.BaseUserCommentLimit = normalizeCommentLimitValue(cfg.BaseUserCommentLimit, defaults.BaseUserCommentLimit)
	cfg.StarredCommentLimit = normalizeCommentLimitValue(cfg.StarredCommentLimit, defaults.StarredCommentLimit)
	cfg.AdminCommentLimit = normalizeCommentLimitValue(cfg.AdminCommentLimit, defaults.AdminCommentLimit)
	if cfg.TagWeights == nil {
		cfg.TagWeights = map[string]float64{}
	}
	normalizedTags := make(map[string]float64, len(cfg.TagWeights))
	for rawKey, rawValue := range cfg.TagWeights {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			continue
		}
		normalizedTags[key] = normalizeCommentWeightValue(rawValue, 0)
	}
	cfg.TagWeights = normalizedTags
	return cfg
}

func normalizeCommentLimitValue(value int, fallback int) int {
	if value <= 0 {
		value = fallback
	}
	if value < defaultCommentLimitMin {
		return defaultCommentLimitMin
	}
	if value > defaultCommentLimitMax {
		return defaultCommentLimitMax
	}
	return value
}

func LoadCommentWeightConfig() CommentWeightConfig {
	raw := LoadConfig(commentWeightConfigKey)
	if raw == "" {
		return defaultCommentWeightConfig()
	}

	var cfg CommentWeightConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return defaultCommentWeightConfig()
	}
	return normalizeCommentWeightConfig(cfg)
}

func SaveCommentWeightConfig(cfg CommentWeightConfig) error {
	cfg = normalizeCommentWeightConfig(cfg)
	data, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	SaveConfig(commentWeightConfigKey, string(data))
	return nil
}

func parseUserTags(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	var tags []string
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return nil
	}
	return tags
}

func roundCommentWeight(value float64) float64 {
	return math.Round(value*100) / 100
}

func computeAuthorWeight(record *TelemetryRecord, cfg CommentWeightConfig) float64 {
	total := cfg.BaseUserWeight
	if record == nil {
		return roundCommentWeight(total)
	}
	if record.IsStarred {
		total += cfg.StarredUserWeight
	}
	if record.IsAdmin {
		total += cfg.AdminUserWeight
	}
	for _, tag := range parseUserTags(record.Tags) {
		total += cfg.TagWeights[tag]
	}
	return roundCommentWeight(total)
}

func resolveCommentCharacterLimit(record *TelemetryRecord, cfg CommentWeightConfig) int {
	limit := normalizeCommentLimitValue(cfg.BaseUserCommentLimit, defaultCommentCharLimit)
	if record == nil {
		return limit
	}
	if record.IsStarred {
		limit = normalizeCommentLimitValue(cfg.StarredCommentLimit, limit)
	}
	if record.IsAdmin {
		limit = normalizeCommentLimitValue(cfg.AdminCommentLimit, limit)
	}
	return limit
}

func computeCommentWeight(likeCount int, replyCount int, authorWeight float64, manualAdjustment float64) float64 {
	total := defaultBaseCommentWeight +
		(float64(likeCount) * defaultCommentLikeWeight) +
		(float64(replyCount) * defaultCommentReplyWeight) +
		authorWeight +
		normalizeCommentWeightValue(manualAdjustment, 0)
	return roundCommentWeight(total)
}

func buildCommentAuthorWeightMap(machineIDs []string, cfg CommentWeightConfig) map[string]float64 {
	if len(machineIDs) == 0 {
		return map[string]float64{}
	}

	uniqueIDs := make([]string, 0, len(machineIDs))
	seen := make(map[string]struct{}, len(machineIDs))
	for _, machineID := range machineIDs {
		key := strings.TrimSpace(machineID)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		uniqueIDs = append(uniqueIDs, key)
	}

	result := make(map[string]float64, len(uniqueIDs))
	for _, machineID := range uniqueIDs {
		result[machineID] = roundCommentWeight(cfg.BaseUserWeight)
	}

	var records []TelemetryRecord
	db.Model(&TelemetryRecord{}).
		Where("machine_id IN ?", uniqueIDs).
		Select("machine_id, is_starred, is_admin, tags").
		Find(&records)

	for i := range records {
		record := records[i]
		result[record.MachineID] = computeAuthorWeight(&record, cfg)
	}

	return result
}

func initCommentWeightRoutes(admin *gin.RouterGroup) {
	admin.GET("/comment-weights", func(c *gin.Context) {
		cfg := LoadCommentWeightConfig()
		var tags []UserTag
		db.Order("sort_order asc, id asc").Find(&tags)
		c.JSON(200, gin.H{
			"config": cfg,
			"formula": gin.H{
				"base_comment_weight": defaultBaseCommentWeight,
				"like_weight":         defaultCommentLikeWeight,
				"reply_weight":        defaultCommentReplyWeight,
			},
			"tags": tags,
		})
	})

	admin.PUT("/comment-weights", func(c *gin.Context) {
		var req CommentWeightConfig
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}

		cfg := normalizeCommentWeightConfig(req)
		if err := SaveCommentWeightConfig(cfg); err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}

		c.JSON(200, gin.H{"status": "success", "config": cfg})
	})
}

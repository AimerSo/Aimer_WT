package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// AuditLog 合规审计日志（哈希链式存储，不可篡改）
// log_type: comment / moderation / ban / sensitive / report
type AuditLog struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	LogType   string    `gorm:"type:varchar(32);index;not null" json:"log_type"`
	ActorID   string    `gorm:"type:varchar(64);index" json:"actor_id"`
	ActorRole string    `gorm:"type:varchar(16)" json:"actor_role"`
	TargetID  string    `gorm:"type:varchar(64);index" json:"target_id"`
	RefID     uint      `gorm:"index" json:"ref_id"`
	Action    string    `gorm:"type:varchar(64);not null" json:"action"`
	Detail    string    `gorm:"type:text" json:"detail"`
	Version   string    `gorm:"type:varchar(32)" json:"version"`
	IP        string    `gorm:"type:varchar(45)" json:"ip"`
	Timestamp time.Time `gorm:"index;not null" json:"timestamp"`
	PrevHash  string    `gorm:"type:varchar(64);not null" json:"prev_hash"`
	Hash      string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"hash"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// 串行化写入，保证哈希链连续
var auditMu sync.Mutex

// computeAuditHash 计算单条日志的 SHA256 哈希
func computeAuditHash(prevHash string, ts time.Time, logType, action, detail string) string {
	raw := fmt.Sprintf("%s|%s|%s|%s|%s", prevHash, ts.UTC().Format(time.RFC3339Nano), logType, action, detail)
	h := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("%x", h)
}

// getLastAuditHash 获取最新一条日志的哈希，作为新日志的 prev_hash
func getLastAuditHash() string {
	var last AuditLog
	if err := db.Order("id desc").First(&last).Error; err != nil {
		return "genesis"
	}
	return last.Hash
}

// WriteAuditLog 核心写入函数，自动计算 hash 并链接到上一条
func WriteAuditLog(logType, actorID, actorRole, targetID string, refID uint, action, detail, version, ip string) {
	auditMu.Lock()
	defer auditMu.Unlock()

	now := time.Now()
	prevHash := getLastAuditHash()
	hash := computeAuditHash(prevHash, now, logType, action, detail)

	entry := AuditLog{
		LogType:   logType,
		ActorID:   actorID,
		ActorRole: actorRole,
		TargetID:  targetID,
		RefID:     refID,
		Action:    action,
		Detail:    detail,
		Version:   version,
		IP:        ip,
		Timestamp: now,
		PrevHash:  prevHash,
		Hash:      hash,
	}

	if err := db.Create(&entry).Error; err != nil {
		fmt.Printf("[AuditLog] 写入失败: %v\n", err)
	}
}

// WriteAuditLogAsync 异步写入（不阻塞调用方）
func WriteAuditLogAsync(logType, actorID, actorRole, targetID string, refID uint, action, detail, version, ip string) {
	go WriteAuditLog(logType, actorID, actorRole, targetID, refID, action, detail, version, ip)
}

// auditDetail 构造 JSON 格式的 detail 字段
func auditDetail(fields map[string]interface{}) string {
	b, _ := json.Marshal(fields)
	return string(b)
}

// VerifyAuditChain 校验哈希链完整性，返回 (总条数, 错误条数, 第一条错误ID)
func VerifyAuditChain() (total int64, broken int, firstBrokenID uint) {
	var logs []AuditLog
	db.Order("id asc").Find(&logs)
	total = int64(len(logs))

	expectedPrev := "genesis"
	for _, entry := range logs {
		if entry.PrevHash != expectedPrev {
			broken++
			if firstBrokenID == 0 {
				firstBrokenID = entry.ID
			}
		}
		recomputed := computeAuditHash(entry.PrevHash, entry.Timestamp, entry.LogType, entry.Action, entry.Detail)
		if recomputed != entry.Hash {
			broken++
			if firstBrokenID == 0 {
				firstBrokenID = entry.ID
			}
		}
		expectedPrev = entry.Hash
	}
	return
}

// initAuditLogRoutes 注册审计日志 API（无需认证，仅限仪表盘内访问）
func initAuditLogRoutes(r *gin.Engine) {

	// 分页查询日志列表
	r.GET("/dashboard/audit-logs", func(c *gin.Context) {
		logType := c.Query("log_type")
		actorID := c.Query("actor_id")
		targetID := c.Query("target_id")
		action := c.Query("action")
		startDate := c.Query("start_date")
		endDate := c.Query("end_date")
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))

		if page < 1 {
			page = 1
		}
		if pageSize < 1 || pageSize > 200 {
			pageSize = 50
		}

		query := db.Model(&AuditLog{})
		if logType != "" {
			query = query.Where("log_type = ?", logType)
		}
		if actorID != "" {
			query = query.Where("actor_id = ?", actorID)
		}
		if targetID != "" {
			query = query.Where("target_id = ?", targetID)
		}
		if action != "" {
			query = query.Where("action = ?", action)
		}
		if startDate != "" {
			if t, err := time.Parse("2006-01-02", startDate); err == nil {
				query = query.Where("timestamp >= ?", t)
			}
		}
		if endDate != "" {
			if t, err := time.Parse("2006-01-02", endDate); err == nil {
				query = query.Where("timestamp < ?", t.AddDate(0, 0, 1))
			}
		}

		var total int64
		query.Count(&total)

		var logs []AuditLog
		query.Order("id desc").
			Offset((page - 1) * pageSize).
			Limit(pageSize).
			Find(&logs)

		// 批量查询 actor/target 的 UID 序号
		machineIDSet := map[string]bool{}
		for _, l := range logs {
			if l.ActorID != "" {
				machineIDSet[l.ActorID] = true
			}
			if l.TargetID != "" {
				machineIDSet[l.TargetID] = true
			}
		}
		machineIDs := make([]string, 0, len(machineIDSet))
		for id := range machineIDSet {
			machineIDs = append(machineIDs, id)
		}
		seqMap := buildSeqMap(machineIDs)
		aliasMap := buildAliasMap(machineIDs)

		items := make([]map[string]interface{}, 0, len(logs))
		for _, l := range logs {
			item := map[string]interface{}{
				"id":         l.ID,
				"log_type":   l.LogType,
				"actor_id":   l.ActorID,
				"actor_role": l.ActorRole,
				"target_id":  l.TargetID,
				"ref_id":     l.RefID,
				"action":     l.Action,
				"detail":     l.Detail,
				"version":    l.Version,
				"ip":         l.IP,
				"timestamp":  l.Timestamp.Format("2006-01-02 15:04:05"),
				"hash":       l.Hash,
				"prev_hash":  l.PrevHash,
			}
			if seqID, ok := seqMap[l.ActorID]; ok {
				item["actor_uid"] = seqID
			}
			if alias, ok := aliasMap[l.ActorID]; ok && strings.TrimSpace(alias) != "" {
				item["actor_alias"] = alias
			}
			if seqID, ok := seqMap[l.TargetID]; ok {
				item["target_uid"] = seqID
			}
			if alias, ok := aliasMap[l.TargetID]; ok && strings.TrimSpace(alias) != "" {
				item["target_alias"] = alias
			}
			items = append(items, item)
		}

		c.JSON(200, gin.H{
			"logs":      items,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		})
	})

	// 导出全量日志为 JSON 文件
	r.GET("/dashboard/audit-logs/export", func(c *gin.Context) {
		logType := c.Query("log_type")

		query := db.Model(&AuditLog{}).Order("id asc")
		if logType != "" {
			query = query.Where("log_type = ?", logType)
		}

		var logs []AuditLog
		query.Find(&logs)

		// 附加链校验结果
		total, broken, firstBrokenID := VerifyAuditChain()

		export := map[string]interface{}{
			"exported_at": time.Now().Format("2006-01-02 15:04:05"),
			"total_count": len(logs),
			"chain_verification": map[string]interface{}{
				"total_checked":   total,
				"broken_count":    broken,
				"first_broken_id": firstBrokenID,
				"integrity":       broken == 0,
			},
			"logs": logs,
		}

		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=audit_logs_%s.json", time.Now().Format("20060102_150405")))
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.JSON(200, export)
	})

	// 校验哈希链完整性
	r.GET("/dashboard/audit-logs/verify", func(c *gin.Context) {
		total, broken, firstBrokenID := VerifyAuditChain()
		c.JSON(200, gin.H{
			"total_checked":   total,
			"broken_count":    broken,
			"first_broken_id": firstBrokenID,
			"integrity":       broken == 0,
		})
	})

	// 审计日志存储信息
	r.GET("/dashboard/audit-logs/info", func(c *gin.Context) {
		var total int64
		db.Model(&AuditLog{}).Count(&total)

		var oldest, newest AuditLog
		db.Order("id asc").First(&oldest)
		db.Order("id desc").First(&newest)

		var typeCounts []struct {
			LogType string
			Count   int64
		}
		db.Model(&AuditLog{}).Select("log_type, count(*) as count").Group("log_type").Scan(&typeCounts)

		typeMap := map[string]int64{}
		for _, tc := range typeCounts {
			typeMap[tc.LogType] = tc.Count
		}

		c.JSON(http.StatusOK, gin.H{
			"storage":       "telemetry.db → audit_logs 表",
			"total_entries":  total,
			"type_breakdown": typeMap,
			"oldest_entry":   oldest.Timestamp.Format("2006-01-02 15:04:05"),
			"newest_entry":   newest.Timestamp.Format("2006-01-02 15:04:05"),
			"hash_algorithm": "SHA-256",
			"chain_type":     "线性哈希链（每条日志引用上一条的哈希）",
		})
	})
}

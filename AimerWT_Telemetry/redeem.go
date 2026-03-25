package main

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 兑换码字符集（大写字母+数字，去掉易混淆字符 O/0/I/1）
const redeemCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// generateCode 生成指定长度的随机兑换码（格式：XXXX-XXXX-XXXX）
func generateCode(segLen, segCount int) string {
	segments := make([]string, segCount)
	for s := 0; s < segCount; s++ {
		seg := make([]byte, segLen)
		for i := range seg {
			n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(redeemCharset))))
			seg[i] = redeemCharset[n.Int64()]
		}
		segments[s] = string(seg)
	}
	return strings.Join(segments, "-")
}

// 预定义赞助码类型
var redeemPresets = []map[string]interface{}{
	{
		"name":     "sponsor_1",
		"label":    "支持者一级",
		"type":     "sponsor_1",
		"payload":  `{"theme":"supporter.json","bonus":50,"daily_limit_bonus":5,"tag":"sponsor_1"}`,
		"max_uses": 1,
	},
	{
		"name":     "sponsor_2",
		"label":    "支持者二级",
		"type":     "sponsor_2",
		"payload":  `{"theme":"supporter.json","bonus":100,"daily_limit_bonus":10,"tag":"sponsor_2"}`,
		"max_uses": 1,
	},
	{
		"name":     "sponsor_3",
		"label":    "支持者三级",
		"type":     "sponsor_3",
		"payload":  `{"theme":"supporter.json","bonus":150,"daily_limit_bonus":20,"tag":"sponsor_3"}`,
		"max_uses": 1,
	},
	{
		"name":     "sponsor_4",
		"label":    "支持者四级",
		"type":     "sponsor_4",
		"payload":  `{"theme":"supporter.json","bonus":200,"daily_limit_bonus":30,"tag":"sponsor_4"}`,
		"max_uses": 1,
	},
	{
		"name":     "streamer",
		"label":    "主播专属",
		"type":     "streamer",
		"payload":  `{"theme":"supporter.json","bonus":0,"tag":""}`,
		"max_uses": 1,
	},
	{
		"name":     "streamer_share",
		"label":    "主播分享",
		"type":     "streamer_share",
		"payload":  `{"theme":"supporter.json","bonus":0,"tag":""}`,
		"max_uses": 10,
	},
}

var errRedeemRejected = errors.New("redeem rejected")

func validateRedeemPayload(payload string) error {
	if strings.TrimSpace(payload) == "" {
		return errors.New("payload 不能为空")
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &parsed); err != nil {
		return fmt.Errorf("payload 不是合法 JSON: %w", err)
	}
	return nil
}

func getOrCreateAIUserLimit(store *gorm.DB, machineID string) (*AIUserLimit, error) {
	var existing AIUserLimit
	err := store.Where("machine_id = ?", machineID).First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}

	existing = AIUserLimit{MachineID: machineID}
	if err := store.Create(&existing).Error; err != nil {
		return nil, err
	}
	return &existing, nil
}

// executeRedeemPayload 执行兑换码对应的功能，支持自定义弹窗
func executeRedeemPayload(store *gorm.DB, machineID string, redeemCode *RedeemCode) (map[string]interface{}, error) {
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(redeemCode.Payload), &payload); err != nil {
		return nil, fmt.Errorf("payload 解析失败: %v", err)
	}

	var messages []string

	// 处理主题解锁
	themeFile, _ := payload["theme"].(string)
	themeUnlocked := themeFile != ""

	// 处理 AI 永久额度增加
	if bonusVal, ok := payload["bonus"]; ok {
		bonus := 0
		switch v := bonusVal.(type) {
		case float64:
			bonus = int(v)
		case int:
			bonus = v
		}
		if bonus > 0 {
			existing, err := getOrCreateAIUserLimit(store, machineID)
			if err != nil {
				return nil, fmt.Errorf("读取 AI 额度失败: %w", err)
			}
			if err := store.Model(existing).Update("bonus_credits", gorm.Expr("bonus_credits + ?", bonus)).Error; err != nil {
				return nil, fmt.Errorf("发放 AI 永久额度失败: %w", err)
			}
			messages = append(messages, fmt.Sprintf("获得 %d 次永久AI对话额度", bonus))
		}
	}

	// 处理每日对话上限增加
	if dlbVal, ok := payload["daily_limit_bonus"]; ok {
		dlb := 0
		switch v := dlbVal.(type) {
		case float64:
			dlb = int(v)
		case int:
			dlb = v
		}
		if dlb > 0 {
			existing, err := getOrCreateAIUserLimit(store, machineID)
			if err != nil {
				return nil, fmt.Errorf("读取每日额度失败: %w", err)
			}
			newLimit := existing.DailyLimit + dlb
			if err := store.Model(existing).Update("daily_limit", newLimit).Error; err != nil {
				return nil, fmt.Errorf("发放每日额度失败: %w", err)
			}
			messages = append(messages, "每日对话额度增加")
		}
	}

	// 处理用户标签
	if tagName, ok := payload["tag"].(string); ok && tagName != "" {
		var record TelemetryRecord
		err := store.Where("machine_id = ?", machineID).First(&record).Error
		if err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, fmt.Errorf("读取用户标签失败: %w", err)
			}
			record = TelemetryRecord{
				MachineID:  machineID,
				LastSeenAt: time.Now(),
			}
			if err := store.Create(&record).Error; err != nil {
				return nil, fmt.Errorf("创建用户记录失败: %w", err)
			}
		}

		var currentTags []string
		if record.Tags != "" {
			_ = json.Unmarshal([]byte(record.Tags), &currentTags)
		}
		found := false
		for _, t := range currentTags {
			if t == tagName {
				found = true
				break
			}
		}
		if !found {
			currentTags = append(currentTags, tagName)
			tagsJSON, _ := json.Marshal(currentTags)
			if err := store.Model(&record).Update("tags", string(tagsJSON)).Error; err != nil {
				return nil, fmt.Errorf("写入用户标签失败: %w", err)
			}
		}

		var tagDef UserTag
		if err := store.Where("name = ?", tagName).First(&tagDef).Error; err == nil {
			messages = append(messages, fmt.Sprintf("获得「%s」称号", tagDef.DisplayName))
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, fmt.Errorf("读取标签定义失败: %w", err)
		}
	}

	if themeUnlocked {
		messages = append(messages, "解锁支持者专属主题")
	}

	// 构建客户端指令（优先使用自定义弹窗设置）
	resultMsg := "兑换成功！"
	if len(messages) > 0 {
		resultMsg = "🎉 兑换成功！\n" + strings.Join(messages, "\n")
	}
	title := "兑换成功"
	if redeemCode.PopupTitle != "" {
		title = redeemCode.PopupTitle
	}
	if redeemCode.PopupMessage != "" {
		resultMsg = redeemCode.PopupMessage
	}

	cmd := map[string]interface{}{
		"type":           "redeem_result",
		"success":        true,
		"title":          title,
		"message":        resultMsg,
		"popup_style":    redeemCode.PopupStyle,
		"popup_subtitle": redeemCode.PopupSubtitle,
		"popup_logo":     redeemCode.PopupLogo,
		"popup_icon_color": redeemCode.PopupIconColor,
		"theme_unlocked": themeUnlocked,
	}
	if themeUnlocked {
		cmd["theme_file"] = themeFile
	}

	return cmd, nil
}

// initRedeemRoutes 注册兑换码管理 API
func initRedeemRoutes(admin *gin.RouterGroup) {
	redeem := admin.Group("/redeem")
	{
		// 获取兑换码列表
		redeem.GET("", func(c *gin.Context) {
			var codes []RedeemCode
			db.Order("created_at DESC").Find(&codes)

			// 关联每个码的使用记录数（覆盖 used_count 以确保准确）
			result := make([]map[string]interface{}, len(codes))
			for i, code := range codes {
				codeJSON, _ := json.Marshal(code)
				var m map[string]interface{}
				json.Unmarshal(codeJSON, &m)

				// 判断状态
				status := "active"
				if !code.IsActive {
					status = "disabled"
				} else if code.ExpiresAt != nil && code.ExpiresAt.Before(time.Now()) {
					status = "expired"
				} else if code.MaxUses > 0 && code.UsedCount >= code.MaxUses {
					status = "used"
				}
				m["status"] = status
				result[i] = m
			}

			c.JSON(200, gin.H{"codes": result})
		})

		// 获取预定义类型列表
		redeem.GET("/presets", func(c *gin.Context) {
			c.JSON(200, gin.H{"presets": redeemPresets})
		})

		// 生成兑换码（单个或批量）
		redeem.POST("", func(c *gin.Context) {
			var req struct {
				Type           string `json:"type"`
				Payload        string `json:"payload"`
				MaxUses        int    `json:"max_uses"`
				Count          int    `json:"count"`
				Note           string `json:"note"`
				ExpireIn       int    `json:"expire_in"`
				PopupTitle     string `json:"popup_title"`
				PopupMessage   string `json:"popup_message"`
				PopupStyle     string `json:"popup_style"`
				PopupSubtitle  string `json:"popup_subtitle"`
				PopupLogo      string `json:"popup_logo"`
				PopupIconColor string `json:"popup_icon_color"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "参数错误"})
				return
			}

			if req.Count <= 0 {
				req.Count = 1
			}
			if req.Count > 100 {
				req.Count = 100
			}
			if req.MaxUses <= 0 {
				req.MaxUses = 1
			}
			if req.PopupStyle == "" {
				req.PopupStyle = "default"
			}
			if err := validateRedeemPayload(req.Payload); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}

			var expiresAt *time.Time
			if req.ExpireIn > 0 {
				t := time.Now().Add(time.Duration(req.ExpireIn) * 24 * time.Hour)
				expiresAt = &t
			}

			created := make([]RedeemCode, 0, req.Count)
			for i := 0; i < req.Count; i++ {
				codeTemplate := RedeemCode{
					Type:           req.Type,
					Payload:        req.Payload,
					MaxUses:        req.MaxUses,
					IsActive:       true,
					Note:           req.Note,
					ExpiresAt:      expiresAt,
					PopupTitle:     req.PopupTitle,
					PopupMessage:   req.PopupMessage,
					PopupStyle:     req.PopupStyle,
					PopupSubtitle:  req.PopupSubtitle,
					PopupLogo:      req.PopupLogo,
					PopupIconColor: req.PopupIconColor,
				}

				var createdCode RedeemCode
				createdOK := false
				for attempt := 0; attempt < 10; attempt++ {
					code := codeTemplate
					code.Code = generateCode(4, 3)
					if err := db.Create(&code).Error; err != nil {
						if strings.Contains(strings.ToLower(err.Error()), "unique") {
							continue
						}
						log.Printf("[Redeem] 创建兑换码失败: %v", err)
						break
					}
					createdCode = code
					createdOK = true
					break
				}
				if !createdOK {
					log.Printf("[Redeem] 创建兑换码失败: 重试后仍未生成唯一兑换码")
					continue
				}
				created = append(created, createdCode)
			}

			log.Printf("[Redeem] 批量生成 %d 个兑换码 (类型: %s)", len(created), req.Type)
			c.JSON(200, gin.H{"status": "success", "codes": created, "count": len(created)})
		})

		// 修改兑换码（停用/启用/自定义弹窗/payload）
		redeem.PUT("/:id", func(c *gin.Context) {
			id := c.Param("id")
			var req struct {
				IsActive       *bool   `json:"is_active"`
				Note           *string `json:"note"`
				MaxUses        *int    `json:"max_uses"`
				Payload        *string `json:"payload"`
				Type           *string `json:"type"`
				PopupTitle     *string `json:"popup_title"`
				PopupMessage   *string `json:"popup_message"`
				PopupStyle     *string `json:"popup_style"`
				PopupSubtitle  *string `json:"popup_subtitle"`
				PopupLogo      *string `json:"popup_logo"`
				PopupIconColor *string `json:"popup_icon_color"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "参数错误"})
				return
			}

			var code RedeemCode
			if err := db.First(&code, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "兑换码不存在"})
				return
			}

			updates := map[string]interface{}{}
			if req.IsActive != nil {
				updates["is_active"] = *req.IsActive
			}
			if req.Note != nil {
				updates["note"] = *req.Note
			}
			if req.MaxUses != nil {
				updates["max_uses"] = *req.MaxUses
			}
			if req.Payload != nil {
				if err := validateRedeemPayload(*req.Payload); err != nil {
					c.JSON(400, gin.H{"error": err.Error()})
					return
				}
				updates["payload"] = *req.Payload
			}
			if req.Type != nil {
				updates["type"] = *req.Type
			}
			if req.PopupTitle != nil {
				updates["popup_title"] = *req.PopupTitle
			}
			if req.PopupMessage != nil {
				updates["popup_message"] = *req.PopupMessage
			}
			if req.PopupStyle != nil {
				updates["popup_style"] = *req.PopupStyle
			}
			if req.PopupSubtitle != nil {
				updates["popup_subtitle"] = *req.PopupSubtitle
			}
			if req.PopupLogo != nil {
				updates["popup_logo"] = *req.PopupLogo
			}
			if req.PopupIconColor != nil {
				updates["popup_icon_color"] = *req.PopupIconColor
			}
			if len(updates) > 0 {
				db.Model(&code).Updates(updates)
			}
			c.JSON(200, gin.H{"status": "success"})
		})

		// 删除兑换码
		redeem.DELETE("/:id", func(c *gin.Context) {
			id := c.Param("id")
			if err := db.Delete(&RedeemCode{}, id).Error; err != nil {
				c.JSON(500, gin.H{"error": "删除失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success"})
		})

		// 批量删除兑换码
		redeem.POST("/batch/delete", func(c *gin.Context) {
			var req struct {
				IDs []uint `json:"ids"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 {
				c.JSON(400, gin.H{"error": "参数错误"})
				return
			}
			result := db.Where("id IN ?", req.IDs).Delete(&RedeemCode{})
			if result.Error != nil {
				c.JSON(500, gin.H{"error": "批量删除失败"})
				return
			}
			log.Printf("[Redeem] 批量删除 %d 个兑换码", result.RowsAffected)
			c.JSON(200, gin.H{"status": "success", "deleted": result.RowsAffected})
		})

		// 批量更新兑换码状态（启用/停用）
		redeem.PUT("/batch", func(c *gin.Context) {
			var req struct {
				IDs      []uint `json:"ids"`
				IsActive *bool  `json:"is_active"`
			}
			if err := c.ShouldBindJSON(&req); err != nil || len(req.IDs) == 0 || req.IsActive == nil {
				c.JSON(400, gin.H{"error": "参数错误"})
				return
			}
			result := db.Model(&RedeemCode{}).Where("id IN ?", req.IDs).Update("is_active", *req.IsActive)
			if result.Error != nil {
				c.JSON(500, gin.H{"error": "批量更新失败"})
				return
			}
			action := "启用"
			if !*req.IsActive {
				action = "停用"
			}
			log.Printf("[Redeem] 批量%s %d 个兑换码", action, result.RowsAffected)
			c.JSON(200, gin.H{"status": "success", "updated": result.RowsAffected})
		})

		// 使用记录查询
		redeem.GET("/records", func(c *gin.Context) {
			var records []RedeemRecord
			db.Order("created_at DESC").Limit(1000).Find(&records)

			result := make([]map[string]interface{}, len(records))
			for i, r := range records {
				// 关联用户别名
				var alias string
				db.Model(&TelemetryRecord{}).Where("machine_id = ?", r.MachineID).Select("alias").Scan(&alias)

				result[i] = map[string]interface{}{
					"id":         r.ID,
					"code":       r.Code,
					"machine_id": r.MachineID,
					"alias":      alias,
					"created_at": r.CreatedAt.Format("2006-01-02 15:04:05"),
				}
			}
			c.JSON(200, gin.H{"records": result})
		})
	}
}

// handleRedeem 客户端提交兑换码验证（公开端点，UA 校验）
func handleRedeem(c *gin.Context) {
	if !sysConfig.RedeemCodeEnabled {
		c.JSON(403, gin.H{"error": "兑换码功能已关闭"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
	var req struct {
		Code      string `json:"code"`
		MachineID string `json:"machine_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "参数错误"})
		return
	}

	code := strings.TrimSpace(strings.ToUpper(req.Code))
	if code == "" {
		c.JSON(400, gin.H{"error": "请输入兑换码"})
		return
	}
	if req.MachineID == "" {
		c.JSON(400, gin.H{"error": "缺少设备标识"})
		return
	}
	if !ensureClientMachineBinding(c, req.MachineID) {
		return
	}

	var (
		cmd        map[string]interface{}
		failMsg    string
		redeemType string
	)
	err := db.Transaction(func(tx *gorm.DB) error {
		var redeemCode RedeemCode
		if err := tx.Where("code = ?", code).First(&redeemCode).Error; err != nil {
			failMsg = "兑换码无效或不存在"
			return errRedeemRejected
		}

		if !redeemCode.IsActive {
			failMsg = "该兑换码已被停用"
			return errRedeemRejected
		}
		if redeemCode.ExpiresAt != nil && redeemCode.ExpiresAt.Before(time.Now()) {
			failMsg = "该兑换码已过期"
			return errRedeemRejected
		}
		if redeemCode.MaxUses > 0 && redeemCode.UsedCount >= redeemCode.MaxUses {
			failMsg = "该兑换码已被使用完毕"
			return errRedeemRejected
		}

		record := RedeemRecord{Code: code, MachineID: req.MachineID}
		if err := tx.Create(&record).Error; err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") {
				failMsg = "您已使用过此兑换码"
				return errRedeemRejected
			}
			return err
		}

		executedCmd, err := executeRedeemPayload(tx, req.MachineID, &redeemCode)
		if err != nil {
			return err
		}

		updateQuery := tx.Model(&RedeemCode{}).Where("id = ?", redeemCode.ID)
		if redeemCode.MaxUses > 0 {
			updateQuery = updateQuery.Where("used_count < max_uses")
		}
		updateResult := updateQuery.Update("used_count", gorm.Expr("used_count + 1"))
		if updateResult.Error != nil {
			return updateResult.Error
		}
		if updateResult.RowsAffected == 0 {
			failMsg = "该兑换码已被使用完毕"
			return errRedeemRejected
		}

		cmdJSON, _ := json.Marshal(executedCmd)
		pendingUpdate := tx.Model(&TelemetryRecord{}).
			Where("machine_id = ?", req.MachineID).
			Update("pending_command", string(cmdJSON))
		if pendingUpdate.Error != nil {
			return pendingUpdate.Error
		}
		if pendingUpdate.RowsAffected == 0 {
			placeholder := TelemetryRecord{
				MachineID:      req.MachineID,
				PendingCommand: string(cmdJSON),
				LastSeenAt:     time.Now(),
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{{Name: "machine_id"}},
				DoUpdates: clause.Assignments(map[string]interface{}{
					"pending_command": string(cmdJSON),
					"last_seen_at":    time.Now(),
				}),
			}).Create(&placeholder).Error; err != nil {
				return err
			}
		}

		cmd = executedCmd
		redeemType = redeemCode.Type
		return nil
	})
	if err != nil {
		if errors.Is(err, errRedeemRejected) {
			c.JSON(200, gin.H{"status": "fail", "error": failMsg})
			return
		}
		log.Printf("[Redeem] 执行失败: %v", err)
		c.JSON(500, gin.H{"status": "fail", "error": "兑换执行失败"})
		return
	}

	log.Printf("[Redeem] 兑换成功 - 码: %s, 用户: %s, 类型: %s", code, req.MachineID, redeemType)

	c.JSON(200, gin.H{
		"status":  "success",
		"message": "兑换成功",
		"command": cmd,
	})
}

// 统计辅助函数
func getRedeemStats() map[string]interface{} {
	var total, active, used, expired int64

	db.Model(&RedeemCode{}).Count(&total)
	db.Model(&RedeemCode{}).Where("is_active = ? AND (expires_at IS NULL OR expires_at > ?) AND (max_uses = 0 OR used_count < max_uses)", true, time.Now()).Count(&active)
	db.Model(&RedeemCode{}).Where("max_uses > 0 AND used_count >= max_uses").Count(&used)
	db.Model(&RedeemCode{}).Where("expires_at IS NOT NULL AND expires_at <= ?", time.Now()).Count(&expired)

	var totalRecords int64
	db.Model(&RedeemRecord{}).Count(&totalRecords)

	return map[string]interface{}{
		"total":         total,
		"active":        active,
		"used":          used,
		"expired":       expired,
		"total_records": totalRecords,
	}
}

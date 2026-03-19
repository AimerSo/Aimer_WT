package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

// executeRedeemPayload 执行兑换码对应的功能，支持自定义弹窗
func executeRedeemPayload(machineID string, redeemCode *RedeemCode) (map[string]interface{}, error) {
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
			var existing AIUserLimit
			if err := db.Where("machine_id = ?", machineID).First(&existing).Error; err != nil {
				existing = AIUserLimit{MachineID: machineID, DailyLimit: 0, BonusCredits: bonus}
				db.Create(&existing)
			} else {
				db.Model(&existing).Update("bonus_credits", gorm.Expr("bonus_credits + ?", bonus))
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
			var existing AIUserLimit
			if err := db.Where("machine_id = ?", machineID).First(&existing).Error; err != nil {
				existing = AIUserLimit{MachineID: machineID, DailyLimit: dlb, BonusCredits: 0}
				db.Create(&existing)
			} else {
				newLimit := existing.DailyLimit + dlb
				db.Model(&existing).Update("daily_limit", newLimit)
			}
			messages = append(messages, "每日对话额度增加")
		}
	}

	// 处理用户标签
	if tagName, ok := payload["tag"].(string); ok && tagName != "" {
		var record TelemetryRecord
		if err := db.Where("machine_id = ?", machineID).First(&record).Error; err == nil {
			var currentTags []string
			if record.Tags != "" {
				json.Unmarshal([]byte(record.Tags), &currentTags)
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
				db.Model(&record).Update("tags", string(tagsJSON))
			}
		}

		var tagDef UserTag
		if err := db.Where("name = ?", tagName).First(&tagDef).Error; err == nil {
			messages = append(messages, fmt.Sprintf("获得「%s」称号", tagDef.DisplayName))
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
				Type         string `json:"type"`
				Payload      string `json:"payload"`
				MaxUses      int    `json:"max_uses"`
				Count        int    `json:"count"`
				Note         string `json:"note"`
				ExpireIn     int    `json:"expire_in"`
				PopupTitle   string `json:"popup_title"`
				PopupMessage string `json:"popup_message"`
				PopupStyle   string `json:"popup_style"`
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

			var expiresAt *time.Time
			if req.ExpireIn > 0 {
				t := time.Now().Add(time.Duration(req.ExpireIn) * 24 * time.Hour)
				expiresAt = &t
			}

			created := make([]RedeemCode, 0, req.Count)
			for i := 0; i < req.Count; i++ {
				code := RedeemCode{
					Code:         generateCode(4, 3),
					Type:         req.Type,
					Payload:      req.Payload,
					MaxUses:      req.MaxUses,
					IsActive:     true,
					Note:         req.Note,
					ExpiresAt:    expiresAt,
					PopupTitle:   req.PopupTitle,
					PopupMessage: req.PopupMessage,
					PopupStyle:   req.PopupStyle,
				}
				if err := db.Create(&code).Error; err != nil {
					log.Printf("[Redeem] 创建兑换码失败: %v", err)
					continue
				}
				created = append(created, code)
			}

			log.Printf("[Redeem] 批量生成 %d 个兑换码 (类型: %s)", len(created), req.Type)
			c.JSON(200, gin.H{"status": "success", "codes": created, "count": len(created)})
		})

		// 修改兑换码（停用/启用/自定义弹窗/payload）
		redeem.PUT("/:id", func(c *gin.Context) {
			id := c.Param("id")
			var req struct {
				IsActive     *bool   `json:"is_active"`
				Note         *string `json:"note"`
				MaxUses      *int    `json:"max_uses"`
				Payload      *string `json:"payload"`
				Type         *string `json:"type"`
				PopupTitle   *string `json:"popup_title"`
				PopupMessage *string `json:"popup_message"`
				PopupStyle   *string `json:"popup_style"`
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

		// 使用记录查询
		redeem.GET("/records", func(c *gin.Context) {
			var records []RedeemRecord
			db.Order("created_at DESC").Limit(200).Find(&records)

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

	// 查询兑换码
	var redeemCode RedeemCode
	if err := db.Where("code = ?", code).First(&redeemCode).Error; err != nil {
		c.JSON(200, gin.H{"status": "fail", "error": "兑换码无效或不存在"})
		return
	}

	// 是否已停用
	if !redeemCode.IsActive {
		c.JSON(200, gin.H{"status": "fail", "error": "该兑换码已被停用"})
		return
	}

	// 是否已过期
	if redeemCode.ExpiresAt != nil && redeemCode.ExpiresAt.Before(time.Now()) {
		c.JSON(200, gin.H{"status": "fail", "error": "该兑换码已过期"})
		return
	}

	// 是否已达到最大使用次数
	if redeemCode.MaxUses > 0 && redeemCode.UsedCount >= redeemCode.MaxUses {
		c.JSON(200, gin.H{"status": "fail", "error": "该兑换码已被使用完毕"})
		return
	}

	// 同一用户是否已用过此码
	var existingRecord int64
	db.Model(&RedeemRecord{}).Where("code = ? AND machine_id = ?", code, req.MachineID).Count(&existingRecord)
	if existingRecord > 0 {
		c.JSON(200, gin.H{"status": "fail", "error": "您已使用过此兑换码"})
		return
	}

	// 验证通过，执行兑换功能
	cmd, err := executeRedeemPayload(req.MachineID, &redeemCode)
	if err != nil {
		log.Printf("[Redeem] 执行失败: %v", err)
		c.JSON(500, gin.H{"status": "fail", "error": "兑换执行失败"})
		return
	}

	// 写入使用记录
	record := RedeemRecord{Code: code, MachineID: req.MachineID}
	db.Create(&record)

	// 递增使用次数
	db.Model(&redeemCode).Update("used_count", gorm.Expr("used_count + 1"))

	// 同时将指令存入 pending_command（作为备份，防止即时响应丢失）
	cmdJSON, _ := json.Marshal(cmd)
	db.Model(&TelemetryRecord{}).Where("machine_id = ?", req.MachineID).Update("pending_command", string(cmdJSON))

	log.Printf("[Redeem] 兑换成功 - 码: %s, 用户: %s, 类型: %s", code, req.MachineID, redeemCode.Type)

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

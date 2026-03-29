package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// nicknamePattern 昵称合法字符：中文、英文字母、数字、横杠、下划线
var nicknamePattern = regexp.MustCompile(`^[\p{Han}a-zA-Z0-9_-]+$`)
var qqPattern = regexp.MustCompile(`^[1-9]\d{4,11}$`)

var (
	errVerifiedUserRequiresBound = errors.New("verified_user_requires_bound_qq")
)

var allowedNicknameRequestStatuses = map[string]struct{}{
	"":         {},
	"pending":  {},
	"approved": {},
	"rejected": {},
}

// isValidNickname 校验昵称格式（中英文/数字/横杠/下划线，≤18字符）
func isValidNickname(nick string) bool {
	if nick == "" {
		return false
	}
	if utf8.RuneCountInString(nick) > 18 {
		return false
	}
	return nicknamePattern.MatchString(nick)
}

func isValidQQ(qq string) bool {
	qq = strings.TrimSpace(qq)
	if qq == "" {
		return false
	}
	return qqPattern.MatchString(qq)
}

func parsePositiveUintParam(raw string) (uint, error) {
	value, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
	if err != nil || value == 0 {
		return 0, fmt.Errorf("invalid_id")
	}
	return uint(value), nil
}

// getOrCreateProfile 获取或创建用户 Profile（首次访问自动初始化 Level=0）
func getOrCreateProfile(machineID string) (UserProfile, error) {
	return getOrCreateProfileTx(db, machineID)
}

func getOrCreateProfileTx(tx *gorm.DB, machineID string) (UserProfile, error) {
	var profile UserProfile
	err := tx.Where("machine_id = ?", machineID).First(&profile).Error
	if err == gorm.ErrRecordNotFound {
		profile = UserProfile{MachineID: machineID, Badges: "[]"}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "machine_id"}},
			DoNothing: true,
		}).Create(&profile).Error; err != nil {
			return UserProfile{}, err
		}
		err = tx.Where("machine_id = ?", machineID).First(&profile).Error
	}
	return profile, err
}

func loadUserProfilesMap(machineIDs []string) map[string]UserProfile {
	if len(machineIDs) == 0 {
		return map[string]UserProfile{}
	}

	unique := make([]string, 0, len(machineIDs))
	seen := make(map[string]struct{}, len(machineIDs))
	for _, rawID := range machineIDs {
		machineID := strings.TrimSpace(rawID)
		if machineID == "" {
			continue
		}
		if _, ok := seen[machineID]; ok {
			continue
		}
		seen[machineID] = struct{}{}
		unique = append(unique, machineID)
	}
	if len(unique) == 0 {
		return map[string]UserProfile{}
	}

	var profiles []UserProfile
	db.Where("machine_id IN ?", unique).Find(&profiles)

	result := make(map[string]UserProfile, len(profiles))
	for _, profile := range profiles {
		result[profile.MachineID] = profile
	}
	return result
}

// recalcLevel 根据经验值重新计算等级（仅在 level>=2 时自动提升，1 级由管理员手动授予）
func recalcLevel(profile *UserProfile) {
	if profile.Level < 2 {
		return
	}
	for lv := 9; lv >= 2; lv-- {
		if profile.Exp >= LevelExpThresholds[lv] {
			profile.Level = lv
			return
		}
	}
	if profile.Level > 1 {
		profile.Level = 1
	}
}

func deriveLevelFromExp(exp int) int {
	for lv := 9; lv >= 2; lv-- {
		if exp >= LevelExpThresholds[lv] {
			return lv
		}
	}
	return 1
}

func loadPendingNicknameRequest(machineID string) (NicknameRequest, bool) {
	machineID = strings.TrimSpace(machineID)
	if machineID == "" {
		return NicknameRequest{}, false
	}

	var req NicknameRequest
	if err := db.Where("machine_id = ? AND status = 'pending'", machineID).
		Order("created_at desc").
		First(&req).Error; err != nil {
		return NicknameRequest{}, false
	}
	return req, true
}

func rejectPendingNicknameRequestsTx(tx *gorm.DB, machineID string) error {
	return tx.Model(&NicknameRequest{}).
		Where("machine_id = ? AND status = 'pending'", machineID).
		Updates(map[string]interface{}{"status": "rejected"}).Error
}

func submitNicknameRequest(machineID, nickname string) (NicknameRequest, bool, error) {
	machineID = strings.TrimSpace(machineID)
	nickname = strings.TrimSpace(nickname)
	if machineID == "" {
		return NicknameRequest{}, false, fmt.Errorf("machine_id_required")
	}
	if !isValidNickname(nickname) {
		return NicknameRequest{}, false, fmt.Errorf("invalid_nickname")
	}

	var createdReq NicknameRequest
	reusedExisting := false

	err := db.Transaction(func(tx *gorm.DB) error {
		var existing NicknameRequest
		err := tx.Where("machine_id = ? AND status = 'pending'", machineID).
			Order("created_at desc").
			First(&existing).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}

		if err == nil {
			if existing.Nickname == nickname {
				createdReq = existing
				reusedExisting = true
				return nil
			}
			if err := rejectPendingNicknameRequestsTx(tx, machineID); err != nil {
				return err
			}
		}

		createdReq = NicknameRequest{
			MachineID: machineID,
			Nickname:  nickname,
			Status:    "pending",
		}
		return tx.Create(&createdReq).Error
	})

	return createdReq, reusedExisting, err
}

// serializeProfile 序列化为前端友好格式（不暴露 MachineID）
func serializeProfile(p UserProfile) map[string]interface{} {
	var badges interface{}
	if err := json.Unmarshal([]byte(p.Badges), &badges); err != nil {
		badges = []interface{}{}
	}
	pendingNicknameReq, hasPendingNicknameReq := loadPendingNicknameRequest(p.MachineID)
	badgesEnabled := sysConfig.BadgeSystemEnabled
	nicknameEnabled := sysConfig.NicknameChangeEnabled
	avatarEnabled := sysConfig.AvatarUploadEnabled
	if !badgesEnabled {
		badges = []interface{}{}
	}
	// 认证用户且功能开启才可修改
	canSetNickname := p.Verified && p.Level >= 1 && nicknameEnabled
	canSetAvatar := p.Verified && p.Level >= 1 && avatarEnabled
	nextLevelExp := 0
	if p.Level >= 0 && p.Level < len(LevelExpThresholds)-1 {
		nextLevelExp = LevelExpThresholds[p.Level+1]
	}
	// 查询用户 UID 序号（TelemetryRecord.ID）
	var seqID uint
	db.Model(&TelemetryRecord{}).Where("machine_id = ?", p.MachineID).Select("id").Scan(&seqID)
	return map[string]interface{}{
		"id":                      p.ID,
		"seq_id":                  seqID,
		"nickname":                p.Nickname,
		"bound_qq":                p.BoundQQ,
		"has_bound_qq":            strings.TrimSpace(p.BoundQQ) != "",
		"avatar_data":             p.AvatarData,
		"level":                   p.Level,
		"exp":                     p.Exp,
		"badges":                  badges,
		"badges_enabled":          badgesEnabled,
		"verified":                p.Verified,
		"can_set_profile":         canSetNickname || canSetAvatar,
		"can_set_nickname":        canSetNickname,
		"can_set_avatar":          canSetAvatar,
		"nickname_change_enabled": nicknameEnabled,
		"avatar_upload_enabled":   avatarEnabled,
		"pending_nickname":        pendingNicknameReq.Nickname,
		"has_pending_nickname":    hasPendingNicknameReq,
		"next_level_exp":          nextLevelExp,
		"created_at":              p.CreatedAt,
		"updated_at":              p.UpdatedAt,
	}
}

// initUserProfileClientRoutes 注册客户端公开 API（GET/POST /user-profile）
func initUserProfileClientRoutes(r *gin.Engine) {

	// GET /user-profile?machine_id=xxx — 获取个人资料
	r.GET("/user-profile", func(c *gin.Context) {
		machineID := strings.TrimSpace(c.Query("machine_id"))
		if machineID == "" {
			c.JSON(400, gin.H{"error": "machine_id 为必填"})
			return
		}
		if !ensureClientMachineBinding(c, machineID) {
			return
		}
		profile, err := getOrCreateProfile(machineID)
		if err != nil {
			c.JSON(500, gin.H{"error": "获取资料失败"})
			return
		}
		c.JSON(200, gin.H{"profile": serializeProfile(profile)})
	})

	// POST /user-profile — 提交昵称变更请求或更新头像（需要 Level >= 1 且已认证）
	r.POST("/user-profile", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req struct {
			MachineID  string `json:"machine_id"`
			Nickname   string `json:"nickname"`
			AvatarData string `json:"avatar_data"`
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
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}

		profile, err := getOrCreateProfile(req.MachineID)
		if err != nil {
			c.JSON(500, gin.H{"error": "获取资料失败"})
			return
		}

		if profile.Level < 1 {
			c.JSON(403, gin.H{"error": "需要达到 1 级才能设置个人资料"})
			return
		}

		if !profile.Verified {
			c.JSON(403, gin.H{"error": "需要通过管理员认证后才能修改资料"})
			return
		}

		updates := map[string]interface{}{}
		nicknameSubmitted := false
		nicknameReused := false
		if req.Nickname != "" {
			if !sysConfig.NicknameChangeEnabled {
				c.JSON(403, gin.H{"error": "昵称修改功能已关闭"})
				return
			}
			nick := strings.TrimSpace(req.Nickname)
			if !isValidNickname(nick) {
				c.JSON(400, gin.H{"error": "昵称仅支持中英文、数字、横杠和下划线，最多 18 个字符"})
				return
			}
			if nick == profile.Nickname {
				c.JSON(400, gin.H{"error": "新昵称与当前昵称相同"})
				return
			}
			if _, reusedExisting, err := submitNicknameRequest(req.MachineID, nick); err != nil {
				c.JSON(500, gin.H{"error": "提交昵称请求失败"})
				return
			} else {
				nicknameReused = reusedExisting
			}
			nicknameSubmitted = true
		}

		if req.AvatarData != "" {
			if !sysConfig.AvatarUploadEnabled {
				c.JSON(403, gin.H{"error": "头像上传功能已关闭"})
				return
			}
			if len(req.AvatarData) > 200*1024 {
				c.JSON(400, gin.H{"error": "头像文件过大，请裁剪后再上传"})
				return
			}
			updates["avatar_data"] = req.AvatarData
		}

		if !nicknameSubmitted && len(updates) == 0 {
			c.JSON(400, gin.H{"error": "没有可提交的资料变更"})
			return
		}

		if len(updates) > 0 {
			if err := db.Model(&profile).Updates(updates).Error; err != nil {
				c.JSON(500, gin.H{"error": "保存资料失败"})
				return
			}
		}
		if err := db.First(&profile, profile.ID).Error; err != nil {
			c.JSON(500, gin.H{"error": "获取最新资料失败"})
			return
		}

		resp := gin.H{
			"status":  "success",
			"profile": serializeProfile(profile),
		}
		if nicknameSubmitted {
			resp["status"] = "pending"
			if nicknameReused {
				resp["message"] = "相同昵称请求已在处理中，请等待管理员审批"
			} else {
				resp["message"] = "昵称修改请求已提交，等待管理员审批"
			}
		}
		c.JSON(200, resp)
	})
}

// initUserProfileAdminRoutes 注册管理员 API（查询/修改用户等级/勋章/经验）
func initUserProfileAdminRoutes(admin *gin.RouterGroup) {
	profileAdmin := admin.Group("/user-profiles")

	// GET /admin/user-profiles?machine_id=xxx — 查看用户资料
	profileAdmin.GET("", func(c *gin.Context) {
		machineID := strings.TrimSpace(c.Query("machine_id"))
		if machineID == "" {
			c.JSON(400, gin.H{"error": "machine_id 为必填"})
			return
		}
		profile, err := getOrCreateProfile(machineID)
		if err != nil {
			c.JSON(500, gin.H{"error": "获取资料失败"})
			return
		}
		c.JSON(200, gin.H{"profile": serializeProfile(profile)})
	})

	// PUT /admin/user-profiles — 管理员修改等级/勋章/经验/认证状态/昵称
	profileAdmin.PUT("", func(c *gin.Context) {
		var req struct {
			MachineID string  `json:"machine_id"`
			Level     *int    `json:"level"`
			Exp       *int    `json:"exp"`
			Badges    string  `json:"badges"`
			Verified  *bool   `json:"verified"`
			Nickname  *string `json:"nickname"`
			BoundQQ   *string `json:"bound_qq"`
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

		if req.Badges != "" {
			var test []interface{}
			if err := json.Unmarshal([]byte(req.Badges), &test); err != nil {
				c.JSON(400, gin.H{"error": "badges 必须是合法的 JSON 数组"})
				return
			}
		}
		if req.Nickname != nil {
			nick := strings.TrimSpace(*req.Nickname)
			if nick != "" && !isValidNickname(nick) {
				c.JSON(400, gin.H{"error": "昵称仅支持中英文、数字、横杠和下划线，最多 18 个字符"})
				return
			}
		}
		if req.BoundQQ != nil {
			qq := strings.TrimSpace(*req.BoundQQ)
			if qq != "" && !isValidQQ(qq) {
				c.JSON(400, gin.H{"error": "QQ 号格式无效，需为 5 到 12 位数字且不能以 0 开头"})
				return
			}
		}

		if err := db.Transaction(func(tx *gorm.DB) error {
			profile, err := getOrCreateProfileTx(tx, req.MachineID)
			if err != nil {
				return err
			}

			updates := map[string]interface{}{}
			effectiveLevel := profile.Level
			effectiveExp := profile.Exp
			effectiveVerified := profile.Verified
			effectiveBoundQQ := strings.TrimSpace(profile.BoundQQ)
			if req.Level != nil {
				lv := *req.Level
				if lv < 0 {
					lv = 0
				}
				if lv > 9 {
					lv = 9
				}
				effectiveLevel = lv
				updates["level"] = lv
			}
			if req.Exp != nil {
				exp := *req.Exp
				if exp < 0 {
					exp = 0
				}
				effectiveExp = exp
				updates["exp"] = exp
				if effectiveLevel >= 2 {
					profile.Level = effectiveLevel
					profile.Exp = exp
					recalcLevel(&profile)
					effectiveLevel = profile.Level
					updates["level"] = effectiveLevel
				}
			}
			if req.Badges != "" {
				updates["badges"] = req.Badges
			}
			if req.Verified != nil {
				effectiveVerified = *req.Verified
				updates["verified"] = *req.Verified
				if *req.Verified {
					if effectiveLevel < 1 {
						effectiveLevel = deriveLevelFromExp(effectiveExp)
						updates["level"] = effectiveLevel
					}
				} else if effectiveLevel == 1 {
					effectiveLevel = 0
					updates["level"] = 0
				}
			}
			if req.Nickname != nil {
				nick := strings.TrimSpace(*req.Nickname)
				updates["nickname"] = nick
			}
			if req.BoundQQ != nil {
				qq := strings.TrimSpace(*req.BoundQQ)
				effectiveBoundQQ = qq
				updates["bound_qq"] = qq
			}
			if effectiveVerified && effectiveBoundQQ == "" {
				return errVerifiedUserRequiresBound
			}

			if len(updates) == 0 {
				return nil
			}
			if err := tx.Model(&UserProfile{}).Where("id = ?", profile.ID).Updates(updates).Error; err != nil {
				return err
			}
			if req.Nickname != nil {
				if err := rejectPendingNicknameRequestsTx(tx, req.MachineID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			switch {
			case errors.Is(err, errVerifiedUserRequiresBound):
				c.JSON(400, gin.H{"error": "认证用户前请先绑定 QQ"})
			default:
				c.JSON(500, gin.H{"error": "保存资料失败"})
			}
			return
		}

		profile, err := getOrCreateProfile(req.MachineID)
		if err != nil {
			c.JSON(500, gin.H{"error": "获取资料失败"})
			return
		}
		c.JSON(200, gin.H{"status": "success", "profile": serializeProfile(profile)})
	})

	// 昵称请求管理
	nicknameAdmin := admin.Group("/nickname-requests")

	// GET /admin/nickname-requests — 昵称请求列表
	nicknameAdmin.GET("", func(c *gin.Context) {
		status := strings.TrimSpace(c.DefaultQuery("status", ""))
		if _, ok := allowedNicknameRequestStatuses[status]; !ok {
			c.JSON(400, gin.H{"error": "status 仅支持 pending/approved/rejected"})
			return
		}
		query := db.Model(&NicknameRequest{})
		if status != "" {
			query = query.Where("status = ?", status)
		}

		var requests []NicknameRequest
		if err := query.Order("created_at desc").Limit(200).Find(&requests).Error; err != nil {
			c.JSON(500, gin.H{"error": "加载昵称请求失败"})
			return
		}

		// 批量查询关联信息
		idSet := map[string]bool{}
		for _, r := range requests {
			idSet[r.MachineID] = true
		}
		idList := make([]string, 0, len(idSet))
		for k := range idSet {
			idList = append(idList, k)
		}

		// 查 UID
		type idRow struct {
			MachineID string
			ID        uint
		}
		var idRows []idRow
		if len(idList) > 0 {
			if err := db.Model(&TelemetryRecord{}).Where("machine_id IN ?", idList).Select("machine_id, id").Scan(&idRows).Error; err != nil {
				c.JSON(500, gin.H{"error": "加载用户序号失败"})
				return
			}
		}
		uidMap := map[string]uint{}
		for _, r := range idRows {
			uidMap[r.MachineID] = r.ID
		}

		// 查别名
		type aliasRow struct {
			MachineID string
			Alias     string
		}
		var aliasRows []aliasRow
		if len(idList) > 0 {
			if err := db.Model(&TelemetryRecord{}).Where("machine_id IN ?", idList).Select("machine_id, alias").Scan(&aliasRows).Error; err != nil {
				c.JSON(500, gin.H{"error": "加载用户别名失败"})
				return
			}
		}
		aliasMap := map[string]string{}
		for _, a := range aliasRows {
			aliasMap[a.MachineID] = a.Alias
		}

		// 查当前昵称
		profiles := loadUserProfilesMap(idList)

		result := make([]map[string]interface{}, len(requests))
		for i, r := range requests {
			uid := "?"
			if seqID, ok := uidMap[r.MachineID]; ok {
				uid = fmt.Sprintf("%d", seqID)
			}
			result[i] = map[string]interface{}{
				"id":                 r.ID,
				"machine_id":         r.MachineID,
				"uid":                uid,
				"alias":              aliasMap[r.MachineID],
				"current_nickname":   profiles[r.MachineID].Nickname,
				"requested_nickname": r.Nickname,
				"status":             r.Status,
				"created_at":         r.CreatedAt.Format("2006-01-02 15:04:05"),
				"updated_at":         r.UpdatedAt.Format("2006-01-02 15:04:05"),
			}
		}

		c.JSON(200, gin.H{"requests": result})
	})

	// POST /admin/nickname-requests/:id/approve — 批准昵称请求
	nicknameAdmin.POST("/:id/approve", func(c *gin.Context) {
		id, err := parsePositiveUintParam(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "无效的请求 ID"})
			return
		}
		var approvedReq NicknameRequest
		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.First(&approvedReq, id).Error; err != nil {
				return err
			}
			if approvedReq.Status != "pending" {
				return fmt.Errorf("already_processed")
			}
			result := tx.Model(&NicknameRequest{}).
				Where("id = ? AND status = 'pending'", approvedReq.ID).
				Updates(map[string]interface{}{"status": "approved"})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return fmt.Errorf("already_processed")
			}

			profile, err := getOrCreateProfileTx(tx, approvedReq.MachineID)
			if err != nil {
				return err
			}
			if err := tx.Model(&UserProfile{}).Where("id = ?", profile.ID).
				Update("nickname", approvedReq.Nickname).Error; err != nil {
				return err
			}
			return tx.Model(&NicknameRequest{}).
				Where("machine_id = ? AND status = 'pending' AND id <> ?", approvedReq.MachineID, approvedReq.ID).
				Updates(map[string]interface{}{"status": "rejected"}).Error
		})
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(404, gin.H{"error": "请求不存在"})
				return
			}
			if err.Error() == "already_processed" {
				c.JSON(409, gin.H{"error": "该请求已被处理"})
				return
			}
			c.JSON(500, gin.H{"error": "批准昵称请求失败"})
			return
		}

		c.JSON(200, gin.H{
			"status":     "success",
			"message":    "昵称已批准并生效",
			"machine_id": approvedReq.MachineID,
			"nickname":   approvedReq.Nickname,
		})
	})

	// POST /admin/nickname-requests/:id/reject — 拒绝昵称请求
	nicknameAdmin.POST("/:id/reject", func(c *gin.Context) {
		id, err := parsePositiveUintParam(c.Param("id"))
		if err != nil {
			c.JSON(400, gin.H{"error": "无效的请求 ID"})
			return
		}
		var rejectedReq NicknameRequest
		err = db.Transaction(func(tx *gorm.DB) error {
			if err := tx.First(&rejectedReq, id).Error; err != nil {
				return err
			}
			if rejectedReq.Status != "pending" {
				return fmt.Errorf("already_processed")
			}
			result := tx.Model(&NicknameRequest{}).
				Where("id = ? AND status = 'pending'", rejectedReq.ID).
				Updates(map[string]interface{}{"status": "rejected"})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return fmt.Errorf("already_processed")
			}
			return nil
		})
		if err != nil {
			if err == gorm.ErrRecordNotFound {
				c.JSON(404, gin.H{"error": "请求不存在"})
				return
			}
			if err.Error() == "already_processed" {
				c.JSON(409, gin.H{"error": "该请求已被处理"})
				return
			}
			c.JSON(500, gin.H{"error": "拒绝昵称请求失败"})
			return
		}

		c.JSON(200, gin.H{
			"status":     "success",
			"message":    "昵称请求已拒绝",
			"machine_id": rejectedReq.MachineID,
		})
	})
}

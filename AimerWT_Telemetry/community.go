package main

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// NoticeComment 公告评论
type NoticeComment struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	NoticeID  uint      `gorm:"index:idx_notice_comment_notice_parent_status_created,priority:1;index:idx_notice_comment_notice_machine_created,priority:1;not null" json:"notice_id"`
	ParentID  uint      `gorm:"index:idx_notice_comment_notice_parent_status_created,priority:2;default:0" json:"parent_id"`
	MachineID string    `gorm:"index:idx_notice_comment_notice_machine_created,priority:2;type:varchar(64);not null" json:"machine_id"`
	Content   string    `gorm:"type:text;not null" json:"content"`
	LikeCount int       `gorm:"default:0" json:"like_count"`
	Status    string    `gorm:"index:idx_notice_comment_notice_parent_status_created,priority:3;type:varchar(16);default:'visible'" json:"status"`
	CreatedAt time.Time `gorm:"autoCreateTime;index:idx_notice_comment_notice_parent_status_created,priority:4;index:idx_notice_comment_notice_machine_created,priority:3" json:"created_at"`
}

// NoticeCommentLike 评论点赞记录
type NoticeCommentLike struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	CommentID uint      `gorm:"uniqueIndex:idx_comment_like_unique;index:idx_comment_like_machine_comment,priority:2;not null" json:"comment_id"`
	MachineID string    `gorm:"uniqueIndex:idx_comment_like_unique;index:idx_comment_like_machine_comment,priority:1;type:varchar(64);not null" json:"machine_id"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

// NoticeCommentBan 公告评论资格封禁记录
type NoticeCommentBan struct {
	ID        uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID string    `gorm:"uniqueIndex;type:varchar(64);not null" json:"machine_id"`
	Reason    string    `gorm:"type:text" json:"reason"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

type rankedNoticeComment struct {
	Comment      NoticeComment
	ReplyCount   int
	AuthorWeight float64
	WeightScore  float64
}

type commentReplyCountRow struct {
	ParentID   uint
	ReplyCount int
}

// 序列化评论为前端友好的格式，关联 UID 序号和标签
func serializeComment(c NoticeComment, seqMap map[string]uint, likedSet map[uint]struct{}, tagsMap map[string]string) map[string]interface{} {
	uid := "?"
	if seqID, ok := seqMap[c.MachineID]; ok {
		uid = fmt.Sprintf("%d", seqID)
	}
	_, liked := likedSet[c.ID]

	tags := "[]"
	if t, ok := tagsMap[c.MachineID]; ok && t != "" {
		tags = t
	}

	return map[string]interface{}{
		"id":         c.ID,
		"notice_id":  c.NoticeID,
		"parent_id":  c.ParentID,
		"uid":        uid,
		"content":    c.Content,
		"like_count": c.LikeCount,
		"liked":      liked,
		"status":     c.Status,
		"tags":       tags,
		"created_at": c.CreatedAt.Format("2006-01-02 15:04:05"),
	}
}

// 批量查询 MachineID → UID 序号映射，同时获取 tags
func buildSeqMap(machineIDs []string) map[string]uint {
	if len(machineIDs) == 0 {
		return map[string]uint{}
	}

	type idRow struct {
		MachineID string
		ID        uint
	}
	var rows []idRow
	db.Model(&TelemetryRecord{}).Where("machine_id IN ?", machineIDs).Select("machine_id, id").Scan(&rows)

	result := make(map[string]uint, len(rows))
	for _, r := range rows {
		result[r.MachineID] = r.ID
	}
	return result
}

// buildTagsMap 批量查询 MachineID → Tags JSON 映射
func buildTagsMap(machineIDs []string) map[string]string {
	if len(machineIDs) == 0 {
		return map[string]string{}
	}
	type tagRow struct {
		MachineID string
		Tags      string
	}
	var rows []tagRow
	db.Model(&TelemetryRecord{}).Where("machine_id IN ?", machineIDs).Select("machine_id, tags").Scan(&rows)
	result := make(map[string]string, len(rows))
	for _, r := range rows {
		result[r.MachineID] = r.Tags
	}
	return result
}

func buildLikedCommentSet(machineID string, commentIDs []uint) map[uint]struct{} {
	if strings.TrimSpace(machineID) == "" || len(commentIDs) == 0 {
		return map[uint]struct{}{}
	}

	var likedIDs []uint
	db.Model(&NoticeCommentLike{}).
		Where("machine_id = ? AND comment_id IN ?", machineID, commentIDs).
		Pluck("comment_id", &likedIDs)

	likedSet := make(map[uint]struct{}, len(likedIDs))
	for _, id := range likedIDs {
		likedSet[id] = struct{}{}
	}
	return likedSet
}

func getNoticeCommentBan(machineID string) *NoticeCommentBan {
	machineID = strings.TrimSpace(machineID)
	if machineID == "" {
		return nil
	}

	var ban NoticeCommentBan
	if err := db.Where("machine_id = ?", machineID).First(&ban).Error; err != nil {
		return nil
	}
	return &ban
}

func parseNoticeUintParam(c *gin.Context, key string) (uint, bool) {
	value, err := strconv.ParseUint(strings.TrimSpace(c.Param(key)), 10, 64)
	if err != nil || value == 0 {
		c.JSON(400, gin.H{"error": "无效的 ID 参数"})
		return 0, false
	}
	return uint(value), true
}

func parseCommentPageOffset(raw string) int {
	offset, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || offset < 0 {
		return 0
	}
	return offset
}

func parseCommentPageLimit(raw string) int {
	limit, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || limit <= 0 {
		return 12
	}
	if limit > 40 {
		return 40
	}
	return limit
}

func buildReplyCountMap(noticeID uint, parentIDs []uint) map[uint]int {
	if len(parentIDs) == 0 {
		return map[uint]int{}
	}

	var rows []commentReplyCountRow
	db.Model(&NoticeComment{}).
		Where("notice_id = ? AND parent_id IN ? AND status = 'visible'", noticeID, parentIDs).
		Select("parent_id, count(*) as reply_count").
		Group("parent_id").
		Scan(&rows)

	result := make(map[uint]int, len(rows))
	for _, row := range rows {
		result[row.ParentID] = row.ReplyCount
	}
	return result
}

func buildRankedNoticeComments(noticeID uint) ([]rankedNoticeComment, error) {
	var comments []NoticeComment
	if err := db.Where("notice_id = ? AND parent_id = 0 AND status = 'visible'", noticeID).
		Order("created_at desc").
		Find(&comments).Error; err != nil {
		return nil, err
	}

	commentIDs := make([]uint, 0, len(comments))
	machineIDs := make([]string, 0, len(comments))
	for _, comment := range comments {
		commentIDs = append(commentIDs, comment.ID)
		machineIDs = append(machineIDs, comment.MachineID)
	}

	replyCountMap := buildReplyCountMap(noticeID, commentIDs)
	weightCfg := LoadCommentWeightConfig()
	authorWeightMap := buildCommentAuthorWeightMap(machineIDs, weightCfg)

	ranked := make([]rankedNoticeComment, 0, len(comments))
	for _, comment := range comments {
		replyCount := replyCountMap[comment.ID]
		authorWeight := authorWeightMap[comment.MachineID]
		ranked = append(ranked, rankedNoticeComment{
			Comment:      comment,
			ReplyCount:   replyCount,
			AuthorWeight: authorWeight,
			WeightScore:  computeCommentWeight(comment.LikeCount, replyCount, authorWeight),
		})
	}

	sort.SliceStable(ranked, func(i, j int) bool {
		left := ranked[i]
		right := ranked[j]
		if left.WeightScore != right.WeightScore {
			return left.WeightScore > right.WeightScore
		}
		if !left.Comment.CreatedAt.Equal(right.Comment.CreatedAt) {
			return left.Comment.CreatedAt.After(right.Comment.CreatedAt)
		}
		return left.Comment.ID > right.Comment.ID
	})

	return ranked, nil
}

// initCommunityClientRoutes 注册客户端评论 API（公开端点，使用 UA/HMAC 校验）
func initCommunityClientRoutes(r *gin.Engine) {

	// 获取评论列表
	r.GET("/notice-comments/:notice_id", func(c *gin.Context) {
		if !sysConfig.NoticeCommentEnabled {
			c.JSON(200, gin.H{
				"comments":         []map[string]interface{}{},
				"total_count":      0,
				"total_top_count":  0,
				"total_likes":      0,
				"can_comment":      false,
				"ban_reason":       "评论功能已关闭",
				"offset":           0,
				"limit":            0,
				"next_offset":      0,
				"has_more":         false,
				"feature_disabled": true,
			})
			return
		}
		noticeID, ok := parseNoticeUintParam(c, "notice_id")
		if !ok {
			return
		}
		machineID := c.Query("machine_id")
		offset := parseCommentPageOffset(c.DefaultQuery("offset", "0"))
		limit := parseCommentPageLimit(c.DefaultQuery("limit", "12"))

		rankedComments, err := buildRankedNoticeComments(noticeID)
		if err != nil {
			c.JSON(500, gin.H{"error": "加载评论失败"})
			return
		}

		totalTopCount := len(rankedComments)
		if offset > totalTopCount {
			offset = totalTopCount
		}
		end := offset + limit
		if end > totalTopCount {
			end = totalTopCount
		}
		pageItems := rankedComments[offset:end]

		idSet := map[string]bool{}
		pageCommentIDs := make([]uint, 0, len(pageItems))
		for _, ranked := range pageItems {
			idSet[ranked.Comment.MachineID] = true
			pageCommentIDs = append(pageCommentIDs, ranked.Comment.ID)
		}
		idList := make([]string, 0, len(idSet))
		for k := range idSet {
			idList = append(idList, k)
		}
		seqMap := buildSeqMap(idList)
		likedSet := buildLikedCommentSet(machineID, pageCommentIDs)
		tagsMap := buildTagsMap(idList)

		result := make([]map[string]interface{}, 0, len(pageItems))
		for _, ranked := range pageItems {
			item := serializeComment(ranked.Comment, seqMap, likedSet, tagsMap)
			item["replies"] = []map[string]interface{}{}
			item["reply_count"] = ranked.ReplyCount
			item["author_weight"] = ranked.AuthorWeight
			item["weight_score"] = ranked.WeightScore
			result = append(result, item)
		}

		// 统计
		var totalCount int64
		db.Model(&NoticeComment{}).Where("notice_id = ? AND status = 'visible'", noticeID).Count(&totalCount)
		var totalLikes int64
		db.Model(&NoticeComment{}).
			Where("notice_id = ? AND status = 'visible'", noticeID).
			Select("COALESCE(SUM(like_count), 0)").
			Scan(&totalLikes)

		ban := getNoticeCommentBan(machineID)
		canComment := ban == nil
		banReason := ""
		if ban != nil {
			banReason = ban.Reason
		}

		c.JSON(200, gin.H{
			"comments":        result,
			"total_count":     totalCount,
			"total_top_count": totalTopCount,
			"total_likes":     totalLikes,
			"can_comment":     canComment,
			"ban_reason":      banReason,
			"offset":          offset,
			"limit":           limit,
			"next_offset":     end,
			"has_more":        end < totalTopCount,
		})
	})

	r.GET("/notice-comments/:notice_id/replies/:comment_id", func(c *gin.Context) {
		if !sysConfig.NoticeCommentEnabled {
			c.JSON(200, gin.H{"replies": []map[string]interface{}{}, "reply_count": 0, "feature_disabled": true})
			return
		}
		noticeID, ok := parseNoticeUintParam(c, "notice_id")
		if !ok {
			return
		}
		commentID, ok := parseNoticeUintParam(c, "comment_id")
		if !ok {
			return
		}
		machineID := c.Query("machine_id")

		var parent NoticeComment
		if err := db.Where("id = ? AND notice_id = ? AND parent_id = 0 AND status = 'visible'", commentID, noticeID).
			First(&parent).Error; err != nil {
			c.JSON(404, gin.H{"error": "评论不存在"})
			return
		}

		var replies []NoticeComment
		if err := db.Where("notice_id = ? AND parent_id = ? AND status = 'visible'", noticeID, commentID).
			Order("created_at asc").
			Find(&replies).Error; err != nil {
			c.JSON(500, gin.H{"error": "加载回复失败"})
			return
		}

		replyIDs := make([]uint, 0, len(replies))
		idSet := map[string]bool{}
		for _, reply := range replies {
			replyIDs = append(replyIDs, reply.ID)
			idSet[reply.MachineID] = true
		}

		idList := make([]string, 0, len(idSet))
		for machineID := range idSet {
			idList = append(idList, machineID)
		}
		seqMap := buildSeqMap(idList)
		likedSet := buildLikedCommentSet(machineID, replyIDs)
		weightCfg := LoadCommentWeightConfig()
		authorWeightMap := buildCommentAuthorWeightMap(idList, weightCfg)
		tagsMap := buildTagsMap(idList)

		result := make([]map[string]interface{}, 0, len(replies))
		for _, reply := range replies {
			authorWeight := authorWeightMap[reply.MachineID]
			item := serializeComment(reply, seqMap, likedSet, tagsMap)
			item["reply_count"] = 0
			item["author_weight"] = authorWeight
			item["weight_score"] = computeCommentWeight(reply.LikeCount, 0, authorWeight)
			result = append(result, item)
		}

		c.JSON(200, gin.H{
			"replies":     result,
			"reply_count": len(result),
		})
	})

	// 发表评论/回复
	r.POST("/notice-comment", func(c *gin.Context) {
		if !sysConfig.NoticeCommentEnabled {
			c.JSON(403, gin.H{"error": "公告评论功能已关闭"})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req struct {
			NoticeID  uint   `json:"notice_id"`
			MachineID string `json:"machine_id"`
			Content   string `json:"content"`
			ParentID  uint   `json:"parent_id"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}

		// 校验必填字段
		content := strings.TrimSpace(req.Content)
		if req.NoticeID == 0 || content == "" || req.MachineID == "" {
			c.JSON(400, gin.H{"error": "notice_id, machine_id, content 为必填"})
			return
		}

		if ban := getNoticeCommentBan(req.MachineID); ban != nil {
			msg := "您已被禁止发表评论"
			if ban.Reason != "" {
				msg += "：" + ban.Reason
			}
			c.JSON(403, gin.H{"error": msg})
			return
		}

		// 内容长度限制
		if len([]rune(content)) > 200 {
			content = string([]rune(content)[:200])
		}

		// 回复层级限制：parent_id 指向的评论本身不能是回复
		if req.ParentID > 0 {
			var parent NoticeComment
			if err := db.First(&parent, req.ParentID).Error; err != nil {
				c.JSON(400, gin.H{"error": "回复的目标评论不存在"})
				return
			}
			if parent.ParentID > 0 {
				// 指向的已经是一条回复，强制改为回复其父评论
				req.ParentID = parent.ParentID
			}
			if parent.NoticeID != req.NoticeID {
				c.JSON(400, gin.H{"error": "回复目标与公告不匹配"})
				return
			}
		}

		// 频率限制：同一用户对同一公告 30 秒内最多 1 条
		var recentCount int64
		threshold := time.Now().Add(-30 * time.Second)
		db.Model(&NoticeComment{}).
			Where("notice_id = ? AND machine_id = ? AND created_at > ?", req.NoticeID, req.MachineID, threshold).
			Count(&recentCount)
		if recentCount > 0 {
			c.JSON(429, gin.H{"error": "发送太频繁，请稍后再试"})
			return
		}

		// 每用户对每条公告的评论总数限制
		var userCommentCount int64
		db.Model(&NoticeComment{}).
			Where("notice_id = ? AND machine_id = ?", req.NoticeID, req.MachineID).
			Count(&userCommentCount)
		if userCommentCount >= 50 {
			c.JSON(429, gin.H{"error": "该公告下您的评论已达上限"})
			return
		}

		comment := NoticeComment{
			NoticeID:  req.NoticeID,
			ParentID:  req.ParentID,
			MachineID: req.MachineID,
			Content:   content,
			Status:    "visible",
		}
		if err := db.Create(&comment).Error; err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}

		seqMap := buildSeqMap([]string{req.MachineID})
		weightCfg := LoadCommentWeightConfig()
		authorWeight := buildCommentAuthorWeightMap([]string{req.MachineID}, weightCfg)[req.MachineID]
		tagsMap := buildTagsMap([]string{req.MachineID})
		commentResp := serializeComment(comment, seqMap, nil, tagsMap)
		commentResp["reply_count"] = 0
		commentResp["author_weight"] = authorWeight
		commentResp["weight_score"] = computeCommentWeight(comment.LikeCount, 0, authorWeight)

		c.JSON(200, gin.H{
			"status":  "success",
			"comment": commentResp,
		})
	})

	// 点赞/取消点赞
	r.POST("/notice-comment-like", func(c *gin.Context) {
		if !sysConfig.NoticeCommentEnabled {
			c.JSON(403, gin.H{"error": "公告评论功能已关闭"})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<10)
		var req struct {
			CommentID uint   `json:"comment_id"`
			MachineID string `json:"machine_id"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}
		if req.CommentID == 0 || req.MachineID == "" {
			c.JSON(400, gin.H{"error": "comment_id, machine_id 为必填"})
			return
		}

		// 确认评论存在
		var comment NoticeComment
		if err := db.First(&comment, req.CommentID).Error; err != nil {
			c.JSON(404, gin.H{"error": "评论不存在"})
			return
		}

		// Toggle 逻辑
		var existing NoticeCommentLike
		err := db.Where("comment_id = ? AND machine_id = ?", req.CommentID, req.MachineID).First(&existing).Error
		if err == nil {
			// 已点赞 → 取消
			db.Delete(&existing)
			db.Model(&comment).Update("like_count", gorm.Expr("CASE WHEN like_count > 0 THEN like_count - 1 ELSE 0 END"))
			c.JSON(200, gin.H{"status": "unliked"})
			return
		}

		// 未点赞 → 添加
		like := NoticeCommentLike{
			CommentID: req.CommentID,
			MachineID: req.MachineID,
		}
		if err := db.Create(&like).Error; err != nil {
			c.JSON(500, gin.H{"error": "操作失败"})
			return
		}
		db.Model(&comment).Update("like_count", gorm.Expr("like_count + 1"))
		c.JSON(200, gin.H{"status": "liked"})
	})
}

// initCommunityAdminRoutes 注册管理端评论管理 API
func initCommunityAdminRoutes(admin *gin.RouterGroup) {
	community := admin.Group("/community")
	{
		// 查看全部评论（分页）
		community.GET("/comments", func(c *gin.Context) {
			noticeIDStr := c.Query("notice_id")
			page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
			pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
			if page < 1 {
				page = 1
			}
			if pageSize < 1 || pageSize > 200 {
				pageSize = 50
			}

			query := db.Model(&NoticeComment{})
			if noticeIDStr != "" {
				query = query.Where("notice_id = ?", noticeIDStr)
			}
			if status := c.Query("status"); status != "" {
				query = query.Where("status = ?", status)
			}

			var total int64
			query.Count(&total)

			var comments []NoticeComment
			query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&comments)

			// 批量查 UID
			idSet := map[string]bool{}
			for _, cm := range comments {
				idSet[cm.MachineID] = true
			}
			idList := make([]string, 0, len(idSet))
			for k := range idSet {
				idList = append(idList, k)
			}
			seqMap := buildSeqMap(idList)

			// 批量查别名
			type aliasRow struct {
				MachineID string
				Alias     string
			}
			var aliasRows []aliasRow
			if len(idList) > 0 {
				db.Model(&TelemetryRecord{}).Where("machine_id IN ?", idList).Select("machine_id, alias").Scan(&aliasRows)
			}
			aliasMap := map[string]string{}
			for _, a := range aliasRows {
				aliasMap[a.MachineID] = a.Alias
			}

			result := make([]map[string]interface{}, len(comments))
			for i, cm := range comments {
				uid := "?"
				if seqID, ok := seqMap[cm.MachineID]; ok {
					uid = fmt.Sprintf("%d", seqID)
				}
				result[i] = map[string]interface{}{
					"id":         cm.ID,
					"notice_id":  cm.NoticeID,
					"parent_id":  cm.ParentID,
					"machine_id": cm.MachineID,
					"uid":        uid,
					"alias":      aliasMap[cm.MachineID],
					"content":    cm.Content,
					"like_count": cm.LikeCount,
					"status":     cm.Status,
					"created_at": cm.CreatedAt.Format("2006-01-02 15:04:05"),
				}
			}

			c.JSON(200, gin.H{
				"comments":  result,
				"total":     total,
				"page":      page,
				"page_size": pageSize,
			})
		})

		// 删除评论（级联删除回复和点赞）
		community.DELETE("/comments/:id", func(c *gin.Context) {
			id := c.Param("id")
			var comment NoticeComment
			if err := db.First(&comment, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "评论不存在"})
				return
			}

			// 级联删除：先删回复的点赞，再删回复，再删本评论点赞，再删本评论
			var replyIDs []uint
			db.Model(&NoticeComment{}).Where("parent_id = ?", comment.ID).Pluck("id", &replyIDs)
			if len(replyIDs) > 0 {
				db.Where("comment_id IN ?", replyIDs).Delete(&NoticeCommentLike{})
				db.Where("parent_id = ?", comment.ID).Delete(&NoticeComment{})
			}
			db.Where("comment_id = ?", comment.ID).Delete(&NoticeCommentLike{})
			db.Delete(&comment)

			c.JSON(200, gin.H{"status": "success"})
		})

		// 修改评论状态
		community.PUT("/comments/:id/status", func(c *gin.Context) {
			id := c.Param("id")
			var req struct {
				Status string `json:"status"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}
			allowed := map[string]bool{"visible": true, "hidden": true, "reported": true}
			if !allowed[req.Status] {
				c.JSON(400, gin.H{"error": "无效的状态值，允许: visible, hidden, reported"})
				return
			}

			var comment NoticeComment
			if err := db.First(&comment, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "评论不存在"})
				return
			}
			db.Model(&comment).Update("status", req.Status)
			c.JSON(200, gin.H{"status": "success"})
		})

		community.GET("/comment-bans", func(c *gin.Context) {
			var bans []NoticeCommentBan
			db.Order("created_at DESC").Find(&bans)

			idSet := map[string]bool{}
			for _, ban := range bans {
				idSet[ban.MachineID] = true
			}
			idList := make([]string, 0, len(idSet))
			for machineID := range idSet {
				idList = append(idList, machineID)
			}
			seqMap := buildSeqMap(idList)

			type aliasRow struct {
				MachineID string
				Alias     string
			}
			var aliasRows []aliasRow
			if len(idList) > 0 {
				db.Model(&TelemetryRecord{}).Where("machine_id IN ?", idList).Select("machine_id, alias").Scan(&aliasRows)
			}
			aliasMap := map[string]string{}
			for _, row := range aliasRows {
				aliasMap[row.MachineID] = row.Alias
			}

			result := make([]map[string]interface{}, len(bans))
			for i, ban := range bans {
				uid := "?"
				if seqID, ok := seqMap[ban.MachineID]; ok {
					uid = fmt.Sprintf("%d", seqID)
				}
				result[i] = map[string]interface{}{
					"id":         ban.ID,
					"machine_id": ban.MachineID,
					"uid":        uid,
					"alias":      aliasMap[ban.MachineID],
					"reason":     ban.Reason,
					"created_at": ban.CreatedAt.Format("2006-01-02 15:04:05"),
					"updated_at": ban.UpdatedAt.Format("2006-01-02 15:04:05"),
				}
			}

			c.JSON(200, gin.H{"bans": result})
		})

		community.POST("/comment-bans", func(c *gin.Context) {
			var req struct {
				MachineID string `json:"machine_id"`
				Reason    string `json:"reason"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}

			req.MachineID = strings.TrimSpace(req.MachineID)
			req.Reason = strings.TrimSpace(req.Reason)
			if req.MachineID == "" {
				c.JSON(400, gin.H{"error": "machine_id 为必填"})
				return
			}

			var existing NoticeCommentBan
			err := db.Where("machine_id = ?", req.MachineID).First(&existing).Error
			if err == nil {
				db.Model(&existing).Updates(map[string]interface{}{
					"reason": req.Reason,
				})
				db.First(&existing, existing.ID)
				c.JSON(200, gin.H{"status": "updated", "ban": existing})
				return
			}
			if err != gorm.ErrRecordNotFound {
				c.JSON(500, gin.H{"error": "查询失败"})
				return
			}

			ban := NoticeCommentBan{
				MachineID: req.MachineID,
				Reason:    req.Reason,
			}
			if err := db.Create(&ban).Error; err != nil {
				c.JSON(500, gin.H{"error": "保存失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success", "ban": ban})
		})

		community.DELETE("/comment-bans/:id", func(c *gin.Context) {
			id := c.Param("id")
			if err := db.Delete(&NoticeCommentBan{}, id).Error; err != nil {
				c.JSON(500, gin.H{"error": "删除失败"})
				return
			}
			c.JSON(200, gin.H{"status": "success"})
		})
	}
}

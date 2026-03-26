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
	ID               uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	NoticeID         uint      `gorm:"index:idx_notice_comment_notice_parent_status_created,priority:1;index:idx_notice_comment_notice_machine_created,priority:1;not null" json:"notice_id"`
	ParentID         uint      `gorm:"index:idx_notice_comment_notice_parent_status_created,priority:2;default:0" json:"parent_id"`
	ReplyToID        uint      `gorm:"index;default:0" json:"reply_to_id"`
	MachineID        string    `gorm:"index:idx_notice_comment_notice_machine_created,priority:2;type:varchar(64);not null" json:"machine_id"`
	Content          string    `gorm:"type:text;not null" json:"content"`
	LikeCount        int       `gorm:"default:0" json:"like_count"`
	WeightAdjustment float64   `gorm:"default:0" json:"weight_adjustment"`
	Status           string    `gorm:"index:idx_notice_comment_notice_parent_status_created,priority:3;type:varchar(16);default:'visible'" json:"status"`
	CreatedAt        time.Time `gorm:"autoCreateTime;index:idx_notice_comment_notice_parent_status_created,priority:4;index:idx_notice_comment_notice_machine_created,priority:3" json:"created_at"`
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
	ID                 uint       `gorm:"primaryKey;autoIncrement" json:"id"`
	MachineID          string     `gorm:"uniqueIndex;type:varchar(64);not null" json:"machine_id"`
	Reason             string     `gorm:"type:text" json:"reason"`
	ExpiresAt          *time.Time `gorm:"index" json:"expires_at,omitempty"`
	CreatedByMachineID string     `gorm:"type:varchar(64)" json:"created_by_machine_id,omitempty"`
	CreatedAt          time.Time  `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt          time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
}

// CommentReport 评论举报记录
type CommentReport struct {
	ID                uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	CommentID         uint      `gorm:"index;not null" json:"comment_id"`
	ReporterMachineID string    `gorm:"type:varchar(64);not null" json:"reporter_machine_id"`
	ReportType        string    `gorm:"type:varchar(32);not null" json:"report_type"`
	Reason            string    `gorm:"type:text" json:"reason"`
	Status            string    `gorm:"type:varchar(16);default:'pending'" json:"status"`
	CreatedAt         time.Time `gorm:"autoCreateTime" json:"created_at"`
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
		"id":                c.ID,
		"notice_id":         c.NoticeID,
		"parent_id":         c.ParentID,
		"reply_to_id":       c.ReplyToID,
		"uid":               uid,
		"content":           c.Content,
		"like_count":        c.LikeCount,
		"liked":             liked,
		"status":            c.Status,
		"tags":              tags,
		"weight_adjustment": roundCommentWeight(c.WeightAdjustment),
		"created_at":        c.CreatedAt.Format("2006-01-02 15:04:05"),
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

func buildAliasMap(machineIDs []string) map[string]string {
	if len(machineIDs) == 0 {
		return map[string]string{}
	}
	type aliasRow struct {
		MachineID string
		Alias     string
	}
	var rows []aliasRow
	db.Model(&TelemetryRecord{}).Where("machine_id IN ?", machineIDs).Select("machine_id, alias").Scan(&rows)
	result := make(map[string]string, len(rows))
	for _, row := range rows {
		result[row.MachineID] = row.Alias
	}
	return result
}

func loadCommentUserRecord(machineID string) *TelemetryRecord {
	machineID = strings.TrimSpace(machineID)
	if machineID == "" {
		return nil
	}

	var record TelemetryRecord
	if err := db.Select("machine_id, is_starred, is_admin, tags").
		Where("machine_id = ?", machineID).
		First(&record).Error; err != nil {
		return nil
	}
	return &record
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
	if ban.ExpiresAt != nil && !ban.ExpiresAt.After(time.Now()) {
		db.Delete(&ban)
		return nil
	}
	return &ban
}

func formatOptionalTimestamp(ts *time.Time) string {
	if ts == nil {
		return ""
	}
	return ts.Format("2006-01-02 15:04:05")
}

func extractLegacyReplyAlias(content string) string {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "回复") {
		return ""
	}
	rest := strings.TrimSpace(strings.TrimPrefix(trimmed, "回复"))
	if !strings.HasPrefix(rest, "@") {
		return ""
	}
	rest = strings.TrimPrefix(rest, "@")
	idx := strings.IndexAny(rest, ":：")
	if idx <= 0 {
		return ""
	}
	return strings.TrimSpace(rest[:idx])
}

func resolveReplyTargetCommentID(comment NoticeComment, seqMap map[string]uint, aliasMap map[string]string, commentMap map[uint]NoticeComment) uint {
	if comment.ReplyToID > 0 {
		return comment.ReplyToID
	}
	if comment.ParentID == 0 || len(commentMap) == 0 {
		return 0
	}

	legacyAlias := extractLegacyReplyAlias(comment.Content)
	if legacyAlias == "" {
		return 0
	}

	for id, candidate := range commentMap {
		if id == comment.ID {
			continue
		}
		if candidate.ID != comment.ParentID && candidate.ParentID != comment.ParentID {
			continue
		}
		if strings.TrimSpace(aliasMap[candidate.MachineID]) == legacyAlias {
			return candidate.ID
		}
		if seqID, ok := seqMap[candidate.MachineID]; ok && ("用户#"+fmt.Sprintf("%d", seqID) == legacyAlias || fmt.Sprintf("%d", seqID) == legacyAlias) {
			return candidate.ID
		}
	}

	return 0
}

func attachCommentMeta(item map[string]interface{}, comment NoticeComment, viewerMachineID string, viewerIsAdmin bool, seqMap map[string]uint, aliasMap map[string]string, commentMap map[uint]NoticeComment) {
	item["can_delete"] = viewerIsAdmin || (viewerMachineID != "" && comment.MachineID == viewerMachineID)
	item["can_manage"] = viewerIsAdmin

	replyTargetID := resolveReplyTargetCommentID(comment, seqMap, aliasMap, commentMap)
	if replyTargetID == 0 {
		return
	}

	item["reply_to_comment_id"] = replyTargetID
	if target, ok := commentMap[replyTargetID]; ok {
		if seqID, found := seqMap[target.MachineID]; found {
			item["reply_to_uid"] = fmt.Sprintf("%d", seqID)
		}
	}
}

func deleteNoticeCommentCascade(commentID uint) error {
	var replyIDs []uint
	if err := db.Model(&NoticeComment{}).Where("parent_id = ?", commentID).Pluck("id", &replyIDs).Error; err != nil {
		return err
	}
	if len(replyIDs) > 0 {
		if err := db.Where("comment_id IN ?", replyIDs).Delete(&NoticeCommentLike{}).Error; err != nil {
			return err
		}
		if err := db.Where("parent_id = ?", commentID).Delete(&NoticeComment{}).Error; err != nil {
			return err
		}
	}
	if err := db.Where("comment_id = ?", commentID).Delete(&NoticeCommentLike{}).Error; err != nil {
		return err
	}
	return db.Delete(&NoticeComment{}, commentID).Error
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

// buildTopRepliesMap 为每条主评论获取前2条最高权重子评论用于预览
func buildTopRepliesMap(noticeID uint, parentIDs []uint, viewerMachineID string, weightCfg CommentWeightConfig) map[uint][]map[string]interface{} {
	result := make(map[uint][]map[string]interface{}, len(parentIDs))
	if len(parentIDs) == 0 {
		return result
	}

	var allReplies []NoticeComment
	db.Where("notice_id = ? AND parent_id IN ? AND status = 'visible'", noticeID, parentIDs).
		Find(&allReplies)

	if len(allReplies) == 0 {
		return result
	}

	// 收集所有 machine_id
	idSet := map[string]bool{}
	replyIDs := make([]uint, 0, len(allReplies))
	for _, r := range allReplies {
		idSet[r.MachineID] = true
		replyIDs = append(replyIDs, r.ID)
	}
	idList := make([]string, 0, len(idSet))
	for k := range idSet {
		idList = append(idList, k)
	}

	seqMap := buildSeqMap(idList)
	aliasMap := buildAliasMap(idList)
	authorWeightMap := buildCommentAuthorWeightMap(idList, weightCfg)
	likedSet := buildLikedCommentSet(viewerMachineID, replyIDs)
	tagsMap := buildTagsMap(idList)

	// 按 parent_id 分组并排序取 top 2
	grouped := map[uint][]rankedNoticeComment{}
	for _, r := range allReplies {
		authorWeight := authorWeightMap[r.MachineID]
		ws := computeCommentWeight(r.LikeCount, 0, authorWeight, r.WeightAdjustment)
		grouped[r.ParentID] = append(grouped[r.ParentID], rankedNoticeComment{
			Comment:      r,
			WeightScore:  ws,
			AuthorWeight: authorWeight,
		})
	}

	for pid, items := range grouped {
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].WeightScore != items[j].WeightScore {
				return items[i].WeightScore > items[j].WeightScore
			}
			return items[i].Comment.ID > items[j].Comment.ID
		})
		topN := 2
		if len(items) < topN {
			topN = len(items)
		}
		previews := make([]map[string]interface{}, 0, topN)
		for _, ranked := range items[:topN] {
			item := serializeComment(ranked.Comment, seqMap, likedSet, tagsMap)
			// 附加 alias 用于前端显示用户名
			if alias, ok := aliasMap[ranked.Comment.MachineID]; ok && strings.TrimSpace(alias) != "" {
				item["alias"] = alias
			}
			item["weight_score"] = ranked.WeightScore
			previews = append(previews, item)
		}
		result[pid] = previews
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
			WeightScore:  computeCommentWeight(comment.LikeCount, replyCount, authorWeight, comment.WeightAdjustment),
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
				"comments":            []map[string]interface{}{},
				"total_count":         0,
				"total_top_count":     0,
				"total_likes":         0,
				"can_comment":         false,
				"ban_reason":          "评论功能已关闭",
				"ban_expires_at":      "",
				"offset":              0,
				"limit":               0,
				"next_offset":         0,
				"has_more":            false,
				"viewer_is_admin":     false,
				"show_weight_score":   false,
				"comment_limit_chars": defaultCommentCharLimit,
				"feature_disabled":    true,
			})
			return
		}
		noticeID, ok := parseNoticeUintParam(c, "notice_id")
		if !ok {
			return
		}
		machineID := c.Query("machine_id")
		viewerRecord := loadCommentUserRecord(machineID)
		viewerIsAdmin := viewerRecord != nil && viewerRecord.IsAdmin
		weightCfg := LoadCommentWeightConfig()
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
		// 收集所有主评论 ID 用于批量查询子评论预览
		allParentIDs := make([]uint, 0, len(pageItems))
		for _, ranked := range pageItems {
			if ranked.ReplyCount > 0 {
				allParentIDs = append(allParentIDs, ranked.Comment.ID)
			}
		}
		// 批量查询每条主评论的 top 2 子评论（按权重排序）
		topRepliesMap := buildTopRepliesMap(noticeID, allParentIDs, machineID, weightCfg)

		for _, ranked := range pageItems {
			item := serializeComment(ranked.Comment, seqMap, likedSet, tagsMap)
			item["replies"] = []map[string]interface{}{}
			item["reply_count"] = ranked.ReplyCount
			item["author_weight"] = ranked.AuthorWeight
			item["weight_score"] = ranked.WeightScore
			if topReplies, ok := topRepliesMap[ranked.Comment.ID]; ok {
				item["top_replies"] = topReplies
			} else {
				item["top_replies"] = []map[string]interface{}{}
			}
			attachCommentMeta(item, ranked.Comment, machineID, viewerIsAdmin, seqMap, nil, nil)
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
		banExpiresAt := ""
		if ban != nil {
			banReason = ban.Reason
			banExpiresAt = formatOptionalTimestamp(ban.ExpiresAt)
		}
		commentLimitChars := resolveCommentCharacterLimit(viewerRecord, weightCfg)

		c.JSON(200, gin.H{
			"comments":            result,
			"total_count":         totalCount,
			"total_top_count":     totalTopCount,
			"total_likes":         totalLikes,
			"can_comment":         canComment,
			"ban_reason":          banReason,
			"ban_expires_at":      banExpiresAt,
			"offset":              offset,
			"limit":               limit,
			"next_offset":         end,
			"has_more":            end < totalTopCount,
			"viewer_is_admin":     viewerIsAdmin,
			"show_weight_score":   viewerIsAdmin,
			"comment_limit_chars": commentLimitChars,
		})
	})

	r.GET("/notice-comments/:notice_id/replies/:comment_id", func(c *gin.Context) {
		if !sysConfig.NoticeCommentEnabled {
			c.JSON(200, gin.H{
				"replies":             []map[string]interface{}{},
				"reply_count":         0,
				"viewer_is_admin":     false,
				"show_weight_score":   false,
				"comment_limit_chars": defaultCommentCharLimit,
				"feature_disabled":    true,
			})
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
		viewerRecord := loadCommentUserRecord(machineID)
		viewerIsAdmin := viewerRecord != nil && viewerRecord.IsAdmin

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
		commentMap := map[uint]NoticeComment{
			parent.ID: parent,
		}
		idSet[parent.MachineID] = true
		for _, reply := range replies {
			replyIDs = append(replyIDs, reply.ID)
			idSet[reply.MachineID] = true
			commentMap[reply.ID] = reply
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
		aliasMap := buildAliasMap(idList)

		result := make([]map[string]interface{}, 0, len(replies))
		for _, reply := range replies {
			authorWeight := authorWeightMap[reply.MachineID]
			item := serializeComment(reply, seqMap, likedSet, tagsMap)
			item["reply_count"] = 0
			item["author_weight"] = authorWeight
			item["weight_score"] = computeCommentWeight(reply.LikeCount, 0, authorWeight, reply.WeightAdjustment)
			attachCommentMeta(item, reply, machineID, viewerIsAdmin, seqMap, aliasMap, commentMap)
			result = append(result, item)
		}

		c.JSON(200, gin.H{
			"replies":             result,
			"reply_count":         len(result),
			"viewer_is_admin":     viewerIsAdmin,
			"show_weight_score":   viewerIsAdmin,
			"comment_limit_chars": resolveCommentCharacterLimit(viewerRecord, weightCfg),
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
			ReplyToID uint   `json:"reply_to_id"`
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

		weightCfg := LoadCommentWeightConfig()
		commenterRecord := loadCommentUserRecord(req.MachineID)
		commentLimit := resolveCommentCharacterLimit(commenterRecord, weightCfg)

		// 内容长度限制
		if len([]rune(content)) > commentLimit {
			c.JSON(400, gin.H{"error": fmt.Sprintf("当前用户组评论最多允许 %d 字", commentLimit)})
			return
		}

		var replyTarget *NoticeComment

		// 回复层级限制：parent_id 始终指向顶级评论，reply_to_id 指向实际回复目标
		if req.ParentID > 0 {
			var rootComment NoticeComment
			if err := db.First(&rootComment, req.ParentID).Error; err != nil {
				c.JSON(400, gin.H{"error": "回复的目标评论不存在"})
				return
			}
			if rootComment.ParentID > 0 {
				if req.ReplyToID == 0 {
					req.ReplyToID = rootComment.ID
				}
				req.ParentID = rootComment.ParentID
				if err := db.First(&rootComment, req.ParentID).Error; err != nil {
					c.JSON(400, gin.H{"error": "回复的目标评论不存在"})
					return
				}
			}
			if rootComment.NoticeID != req.NoticeID {
				c.JSON(400, gin.H{"error": "回复目标与公告不匹配"})
				return
			}
			if req.ReplyToID == 0 {
				req.ReplyToID = rootComment.ID
			}

			var target NoticeComment
			if err := db.First(&target, req.ReplyToID).Error; err != nil {
				c.JSON(400, gin.H{"error": "回复的目标评论不存在"})
				return
			}
			if target.NoticeID != req.NoticeID {
				c.JSON(400, gin.H{"error": "回复目标与公告不匹配"})
				return
			}
			if target.ID != req.ParentID && target.ParentID != req.ParentID {
				c.JSON(400, gin.H{"error": "回复目标不属于当前评论楼层"})
				return
			}
			replyTarget = &target
		} else {
			req.ReplyToID = 0
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
			ReplyToID: req.ReplyToID,
			MachineID: req.MachineID,
			Content:   content,
			Status:    "visible",
		}
		if err := db.Create(&comment).Error; err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}

		machineIDs := []string{req.MachineID}
		commentMap := map[uint]NoticeComment{
			comment.ID: comment,
		}
		if replyTarget != nil {
			machineIDs = append(machineIDs, replyTarget.MachineID)
			commentMap[replyTarget.ID] = *replyTarget
		}

		seqMap := buildSeqMap(machineIDs)
		authorWeight := buildCommentAuthorWeightMap([]string{req.MachineID}, weightCfg)[req.MachineID]
		tagsMap := buildTagsMap([]string{req.MachineID})
		aliasMap := buildAliasMap(machineIDs)
		commentResp := serializeComment(comment, seqMap, nil, tagsMap)
		commentResp["reply_count"] = 0
		commentResp["author_weight"] = authorWeight
		commentResp["weight_score"] = computeCommentWeight(comment.LikeCount, 0, authorWeight, comment.WeightAdjustment)
		attachCommentMeta(commentResp, comment, req.MachineID, commenterRecord != nil && commenterRecord.IsAdmin, seqMap, aliasMap, commentMap)

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
			db.First(&comment, req.CommentID)
			weightCfg := LoadCommentWeightConfig()
			replyCount := 0
			if comment.ParentID == 0 {
				replyCount = buildReplyCountMap(comment.NoticeID, []uint{comment.ID})[comment.ID]
			}
			authorWeight := buildCommentAuthorWeightMap([]string{comment.MachineID}, weightCfg)[comment.MachineID]
			c.JSON(200, gin.H{
				"status":       "unliked",
				"liked":        false,
				"like_count":   comment.LikeCount,
				"weight_score": computeCommentWeight(comment.LikeCount, replyCount, authorWeight, comment.WeightAdjustment),
			})
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
		db.First(&comment, req.CommentID)
		weightCfg := LoadCommentWeightConfig()
		replyCount := 0
		if comment.ParentID == 0 {
			replyCount = buildReplyCountMap(comment.NoticeID, []uint{comment.ID})[comment.ID]
		}
		authorWeight := buildCommentAuthorWeightMap([]string{comment.MachineID}, weightCfg)[comment.MachineID]
		c.JSON(200, gin.H{
			"status":       "liked",
			"liked":        true,
			"like_count":   comment.LikeCount,
			"weight_score": computeCommentWeight(comment.LikeCount, replyCount, authorWeight, comment.WeightAdjustment),
		})
	})

	// 举报评论
	r.POST("/notice-comment-report", func(c *gin.Context) {
		if !sysConfig.NoticeCommentEnabled {
			c.JSON(403, gin.H{"error": "公告评论功能已关闭"})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req struct {
			CommentID  uint   `json:"comment_id"`
			MachineID  string `json:"machine_id"`
			ReportType string `json:"report_type"`
			Reason     string `json:"reason"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}
		if req.CommentID == 0 || req.MachineID == "" || req.ReportType == "" {
			c.JSON(400, gin.H{"error": "comment_id, machine_id, report_type 为必填"})
			return
		}
		allowedTypes := map[string]bool{
			"porn": true, "hostile": true, "privacy": true, "minor": true,
			"ad": true, "political": true, "rumor": true, "spam": true, "other": true,
		}
		if !allowedTypes[req.ReportType] {
			c.JSON(400, gin.H{"error": "无效的举报类型"})
			return
		}
		var comment NoticeComment
		if err := db.First(&comment, req.CommentID).Error; err != nil {
			c.JSON(404, gin.H{"error": "评论不存在"})
			return
		}
		// 防重复：同一用户对同一评论只能举报一次
		var existingCount int64
		db.Model(&CommentReport{}).Where("comment_id = ? AND reporter_machine_id = ?", req.CommentID, req.MachineID).Count(&existingCount)
		if existingCount > 0 {
			c.JSON(409, gin.H{"error": "您已举报过该评论"})
			return
		}
		reason := strings.TrimSpace(req.Reason)
		if len([]rune(reason)) > 100 {
			reason = string([]rune(reason)[:100])
		}
		report := CommentReport{
			CommentID:         req.CommentID,
			ReporterMachineID: req.MachineID,
			ReportType:        req.ReportType,
			Reason:            reason,
			Status:            "pending",
		}
		if err := db.Create(&report).Error; err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}
		c.JSON(200, gin.H{"status": "success"})
	})

	// 删除评论（本人可删自己的评论，管理员可删除任意评论）
	r.DELETE("/notice-comments/:comment_id", func(c *gin.Context) {
		commentID, ok := parseNoticeUintParam(c, "comment_id")
		if !ok {
			return
		}
		machineID := strings.TrimSpace(c.Query("machine_id"))
		if machineID == "" {
			c.JSON(400, gin.H{"error": "machine_id 为必填"})
			return
		}
		if !ensureClientMachineBinding(c, machineID) {
			return
		}

		actor := loadCommentUserRecord(machineID)
		var comment NoticeComment
		if err := db.First(&comment, commentID).Error; err != nil {
			c.JSON(404, gin.H{"error": "评论不存在"})
			return
		}
		if !(actor != nil && actor.IsAdmin) && comment.MachineID != machineID {
			c.JSON(403, gin.H{"error": "您没有权限删除该评论"})
			return
		}
		if err := deleteNoticeCommentCascade(comment.ID); err != nil {
			c.JSON(500, gin.H{"error": "删除失败"})
			return
		}
		c.JSON(200, gin.H{"status": "success"})
	})

	// 管理员调整单条评论权重
	r.POST("/notice-comments/:comment_id/weight", func(c *gin.Context) {
		commentID, ok := parseNoticeUintParam(c, "comment_id")
		if !ok {
			return
		}
		var req struct {
			MachineID string  `json:"machine_id"`
			Action    string  `json:"action"`
			Amount    float64 `json:"amount"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}

		actor := loadCommentUserRecord(req.MachineID)
		if actor == nil || !actor.IsAdmin {
			c.JSON(403, gin.H{"error": "仅管理员可调整评论权重"})
			return
		}

		action := strings.TrimSpace(req.Action)
		if action != "increase" && action != "decrease" {
			c.JSON(400, gin.H{"error": "action 仅支持 increase 或 decrease"})
			return
		}
		if req.Amount <= 0 {
			c.JSON(400, gin.H{"error": "amount 必须大于 0"})
			return
		}

		var comment NoticeComment
		if err := db.First(&comment, commentID).Error; err != nil {
			c.JSON(404, gin.H{"error": "评论不存在"})
			return
		}

		delta := normalizeCommentWeightValue(req.Amount, 0)
		if action == "decrease" {
			delta = -delta
		}
		newAdjustment := normalizeCommentWeightValue(comment.WeightAdjustment+delta, comment.WeightAdjustment+delta)
		if err := db.Model(&comment).Update("weight_adjustment", newAdjustment).Error; err != nil {
			c.JSON(500, gin.H{"error": "保存失败"})
			return
		}

		replyCount := 0
		if comment.ParentID == 0 {
			replyCount = buildReplyCountMap(comment.NoticeID, []uint{comment.ID})[comment.ID]
		}
		authorWeight := buildCommentAuthorWeightMap([]string{comment.MachineID}, LoadCommentWeightConfig())[comment.MachineID]
		c.JSON(200, gin.H{
			"status":            "success",
			"weight_adjustment": roundCommentWeight(newAdjustment),
			"weight_score":      computeCommentWeight(comment.LikeCount, replyCount, authorWeight, newAdjustment),
		})
	})

	// 管理员封禁评论权限
	r.POST("/notice-comments/:comment_id/ban", func(c *gin.Context) {
		commentID, ok := parseNoticeUintParam(c, "comment_id")
		if !ok {
			return
		}
		var req struct {
			MachineID     string `json:"machine_id"`
			DurationValue int    `json:"duration_value"`
			DurationUnit  string `json:"duration_unit"`
			Reason        string `json:"reason"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "请求数据格式错误"})
			return
		}
		if !ensureClientMachineBinding(c, req.MachineID) {
			return
		}

		actor := loadCommentUserRecord(req.MachineID)
		if actor == nil || !actor.IsAdmin {
			c.JSON(403, gin.H{"error": "仅管理员可封禁评论权限"})
			return
		}
		if req.DurationValue <= 0 {
			c.JSON(400, gin.H{"error": "封禁时长必须大于 0"})
			return
		}

		var duration time.Duration
		switch strings.TrimSpace(req.DurationUnit) {
		case "minute":
			duration = time.Duration(req.DurationValue) * time.Minute
		case "hour":
			duration = time.Duration(req.DurationValue) * time.Hour
		case "day":
			duration = time.Duration(req.DurationValue) * 24 * time.Hour
		default:
			c.JSON(400, gin.H{"error": "duration_unit 仅支持 minute / hour / day"})
			return
		}
		if duration > 365*24*time.Hour {
			c.JSON(400, gin.H{"error": "封禁时长不能超过 365 天"})
			return
		}

		var comment NoticeComment
		if err := db.First(&comment, commentID).Error; err != nil {
			c.JSON(404, gin.H{"error": "评论不存在"})
			return
		}

		expiresAt := time.Now().Add(duration)
		reason := strings.TrimSpace(req.Reason)
		updateData := map[string]interface{}{
			"reason":                reason,
			"expires_at":            expiresAt,
			"created_by_machine_id": req.MachineID,
		}

		var existing NoticeCommentBan
		err := db.Where("machine_id = ?", comment.MachineID).First(&existing).Error
		if err == nil {
			if err := db.Model(&existing).Updates(updateData).Error; err != nil {
				c.JSON(500, gin.H{"error": "保存失败"})
				return
			}
		} else if err == gorm.ErrRecordNotFound {
			ban := NoticeCommentBan{
				MachineID:          comment.MachineID,
				Reason:             reason,
				ExpiresAt:          &expiresAt,
				CreatedByMachineID: req.MachineID,
			}
			if err := db.Create(&ban).Error; err != nil {
				c.JSON(500, gin.H{"error": "保存失败"})
				return
			}
		} else {
			c.JSON(500, gin.H{"error": "查询失败"})
			return
		}

		c.JSON(200, gin.H{
			"status":     "success",
			"machine_id": comment.MachineID,
			"reason":     reason,
			"expires_at": expiresAt.Format("2006-01-02 15:04:05"),
			"comment_id": comment.ID,
		})
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
			if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
				// 搜索内容或查找UID对应的MachineID
				var matchedMachineIDs []string
				db.Model(&TelemetryRecord{}).Where("CAST(id AS TEXT) LIKE ?", "%"+keyword+"%").Pluck("machine_id", &matchedMachineIDs)
				if len(matchedMachineIDs) > 0 {
					query = query.Where("content LIKE ? OR machine_id IN ?", "%"+keyword+"%", matchedMachineIDs)
				} else {
					query = query.Where("content LIKE ?", "%"+keyword+"%")
				}
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
			commentID, ok := parseNoticeUintParam(c, "id")
			if !ok {
				return
			}
			var comment NoticeComment
			if err := db.First(&comment, commentID).Error; err != nil {
				c.JSON(404, gin.H{"error": "评论不存在"})
				return
			}
			if err := deleteNoticeCommentCascade(comment.ID); err != nil {
				c.JSON(500, gin.H{"error": "删除失败"})
				return
			}

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
			db.Where("expires_at IS NOT NULL AND expires_at <= ?", time.Now()).Delete(&NoticeCommentBan{})

			var bans []NoticeCommentBan
			db.Where("expires_at IS NULL OR expires_at > ?", time.Now()).Order("created_at DESC").Find(&bans)

			idSet := map[string]bool{}
			for _, ban := range bans {
				idSet[ban.MachineID] = true
			}
			idList := make([]string, 0, len(idSet))
			for machineID := range idSet {
				idList = append(idList, machineID)
			}
			seqMap := buildSeqMap(idList)
			aliasMap := buildAliasMap(idList)

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
					"expires_at": formatOptionalTimestamp(ban.ExpiresAt),
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

		// 举报列表查询
		community.GET("/comment-reports", func(c *gin.Context) {
			page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
			pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
			if page < 1 {
				page = 1
			}
			if pageSize < 1 || pageSize > 100 {
				pageSize = 20
			}
			statusFilter := c.Query("status")

			query := db.Model(&CommentReport{})
			if statusFilter != "" {
				query = query.Where("status = ?", statusFilter)
			}

			var total int64
			query.Count(&total)

			var reports []CommentReport
			query.Order("created_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&reports)

			// 收集所有 comment_id 和 machine_id
			commentIDSet := map[uint]bool{}
			machineIDSet := map[string]bool{}
			for _, r := range reports {
				commentIDSet[r.CommentID] = true
				machineIDSet[r.ReporterMachineID] = true
			}

			// 查评论详情
			commentIDs := make([]uint, 0, len(commentIDSet))
			for id := range commentIDSet {
				commentIDs = append(commentIDs, id)
			}
			var comments []NoticeComment
			if len(commentIDs) > 0 {
				db.Where("id IN ?", commentIDs).Find(&comments)
			}
			commentMap := map[uint]NoticeComment{}
			for _, cm := range comments {
				commentMap[cm.ID] = cm
				machineIDSet[cm.MachineID] = true
			}

			machineIDs := make([]string, 0, len(machineIDSet))
			for mid := range machineIDSet {
				machineIDs = append(machineIDs, mid)
			}
			seqMap := buildSeqMap(machineIDs)

			type aliasRow struct {
				MachineID string
				Alias     string
			}
			var aliasRows []aliasRow
			if len(machineIDs) > 0 {
				db.Model(&TelemetryRecord{}).Where("machine_id IN ?", machineIDs).Select("machine_id, alias").Scan(&aliasRows)
			}
			aliasMap := map[string]string{}
			for _, a := range aliasRows {
				aliasMap[a.MachineID] = a.Alias
			}

			result := make([]map[string]interface{}, len(reports))
			for i, r := range reports {
				reporterUID := "?"
				if seqID, ok := seqMap[r.ReporterMachineID]; ok {
					reporterUID = fmt.Sprintf("%d", seqID)
				}
				item := map[string]interface{}{
					"id":             r.ID,
					"comment_id":     r.CommentID,
					"report_type":    r.ReportType,
					"reason":         r.Reason,
					"status":         r.Status,
					"reporter_uid":   reporterUID,
					"reporter_alias": aliasMap[r.ReporterMachineID],
					"created_at":     r.CreatedAt.Format("2006-01-02 15:04:05"),
				}
				if cm, ok := commentMap[r.CommentID]; ok {
					reportedUID := "?"
					if seqID, ok2 := seqMap[cm.MachineID]; ok2 {
						reportedUID = fmt.Sprintf("%d", seqID)
					}
					item["reported_uid"] = reportedUID
					item["reported_alias"] = aliasMap[cm.MachineID]
					item["comment_content"] = cm.Content
					item["comment_notice_id"] = cm.NoticeID
				} else {
					item["reported_uid"] = "?"
					item["reported_alias"] = ""
					item["comment_content"] = "[评论已删除]"
					item["comment_notice_id"] = 0
				}
				result[i] = item
			}

			c.JSON(200, gin.H{
				"reports":   result,
				"total":     total,
				"page":      page,
				"page_size": pageSize,
			})
		})

		// 更新举报状态（已处理/忽略）
		community.PUT("/comment-reports/:id", func(c *gin.Context) {
			id := c.Param("id")
			var req struct {
				Status string `json:"status"`
			}
			if err := c.ShouldBindJSON(&req); err != nil {
				c.JSON(400, gin.H{"error": "请求数据格式错误"})
				return
			}
			allowed := map[string]bool{"pending": true, "resolved": true, "dismissed": true}
			if !allowed[req.Status] {
				c.JSON(400, gin.H{"error": "无效的状态值"})
				return
			}
			var report CommentReport
			if err := db.First(&report, id).Error; err != nil {
				c.JSON(404, gin.H{"error": "举报记录不存在"})
				return
			}
			db.Model(&report).Update("status", req.Status)
			c.JSON(200, gin.H{"status": "success"})
		})
	}
}

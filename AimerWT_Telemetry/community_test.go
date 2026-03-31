package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupCommunityTestDB(t *testing.T) {
	t.Helper()

	var err error
	db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "community_test.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	if err := db.AutoMigrate(
		&TelemetryRecord{},
		&ContentConfig{},
		&ClientDeviceToken{},
		&UserTag{},
		&NoticeComment{},
		&NoticeCommentLike{},
		&NoticeCommentBan{},
		&CommentReport{},
		&UserProfile{},
	); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}
}

func setupCommunityTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	initCommunityClientRoutes(r)
	admin := r.Group("/admin")
	initCommentWeightRoutes(admin)
	return r
}

func performRequest(r http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func performSignedCommunityRequest(r http.Handler, method, path string, body any, machineID string) *httptest.ResponseRecorder {
	return performSignedCommunityRequestWithRoute(r, method, path, path, body, machineID)
}

func performSignedCommunityRequestWithRoute(r http.Handler, method, requestPath, signedPath string, body any, machineID string) *httptest.ResponseRecorder {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}

	req := httptest.NewRequest(method, requestPath, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range buildSignedTestHeaders(signedPath, method, machineID, clientAuthSecret) {
		req.Header.Set(key, value)
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func decodeJSONBody[T any](t *testing.T, rr *httptest.ResponseRecorder) T {
	t.Helper()
	var target T
	if err := json.Unmarshal(rr.Body.Bytes(), &target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return target
}

func TestCommentWeightRoutes(t *testing.T) {
	setupCommunityTestDB(t)
	router := setupCommunityTestRouter()

	if err := db.Create(&UserTag{Name: "sponsor_1", DisplayName: "一级赞助者", Icon: "ri-heart-line"}).Error; err != nil {
		t.Fatalf("seed tag: %v", err)
	}

	getResp := performRequest(router, http.MethodGet, "/admin/comment-weights", nil)
	if getResp.Code != http.StatusOK {
		t.Fatalf("unexpected get status: %d", getResp.Code)
	}

	var initial struct {
		Config CommentWeightConfig `json:"config"`
		Tags   []UserTag           `json:"tags"`
	}
	initial = decodeJSONBody[struct {
		Config CommentWeightConfig `json:"config"`
		Tags   []UserTag           `json:"tags"`
	}](t, getResp)

	if initial.Config.BaseUserWeight != 1 {
		t.Fatalf("default base user weight = %v, want 1", initial.Config.BaseUserWeight)
	}
	if initial.Config.BaseUserCommentLimit != 200 || initial.Config.StarredCommentLimit != 200 || initial.Config.AdminCommentLimit != 200 {
		t.Fatalf("unexpected default comment limits: %+v", initial.Config)
	}
	if initial.Config.CommentRateWindow != 60 || initial.Config.CommentRateMax != 5 {
		t.Fatalf("unexpected default comment rate config: %+v", initial.Config)
	}
	if len(initial.Tags) != 1 || initial.Tags[0].Name != "sponsor_1" {
		t.Fatalf("unexpected tags payload: %+v", initial.Tags)
	}

	payload := CommentWeightConfig{
		BaseUserWeight:       1.5,
		StarredUserWeight:    0.5,
		AdminUserWeight:      1,
		BaseUserCommentLimit: 200,
		StarredCommentLimit:  240,
		AdminCommentLimit:    360,
		CommentRateWindow:    90,
		CommentRateMax:       8,
		TagWeights: map[string]float64{
			"sponsor_1": 2,
		},
	}
	putResp := performRequest(router, http.MethodPut, "/admin/comment-weights", payload)
	if putResp.Code != http.StatusOK {
		t.Fatalf("unexpected put status: %d body=%s", putResp.Code, putResp.Body.String())
	}

	reloaded := LoadCommentWeightConfig()
	if reloaded.BaseUserWeight != 1.5 || reloaded.StarredUserWeight != 0.5 || reloaded.TagWeights["sponsor_1"] != 2 {
		t.Fatalf("unexpected persisted config: %+v", reloaded)
	}
	if reloaded.StarredCommentLimit != 240 || reloaded.AdminCommentLimit != 360 {
		t.Fatalf("unexpected persisted config: %+v", reloaded)
	}
	if reloaded.CommentRateWindow != 90 || reloaded.CommentRateMax != 8 {
		t.Fatalf("unexpected persisted config: %+v", reloaded)
	}
}

func TestNoticeCommentsPaginationAndReplies(t *testing.T) {
	setupCommunityTestDB(t)
	router := setupCommunityTestRouter()

	if err := SaveCommentWeightConfig(CommentWeightConfig{
		BaseUserWeight:       1,
		StarredUserWeight:    0.5,
		AdminUserWeight:      0,
		BaseUserCommentLimit: 200,
		StarredCommentLimit:  260,
		AdminCommentLimit:    320,
		TagWeights: map[string]float64{
			"sponsor_1": 1,
		},
	}); err != nil {
		t.Fatalf("save weight config: %v", err)
	}

	users := []TelemetryRecord{
		{MachineID: "viewer", Alias: "viewer"},
		{MachineID: "admin_viewer", Alias: "admin_viewer", IsAdmin: true},
		{MachineID: "normal", Alias: "normal"},
		{MachineID: "tagged", Alias: "tagged", Tags: `["sponsor_1"]`},
		{MachineID: "starred", Alias: "starred", IsStarred: true},
		{MachineID: "reply_user", Alias: "reply_user"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("seed user %d: %v", i, err)
		}
	}
	if err := db.Create(&UserTag{Name: "sponsor_1", DisplayName: "一级赞助者", Icon: "ri-vip-diamond-line"}).Error; err != nil {
		t.Fatalf("seed user tag: %v", err)
	}
	if err := db.Create(&UserProfile{MachineID: "tagged", Nickname: "TagHero"}).Error; err != nil {
		t.Fatalf("seed tagged profile: %v", err)
	}

	now := time.Now()
	noticeID := uint(11)
	comment1 := NoticeComment{NoticeID: noticeID, MachineID: "normal", Content: "normal comment", LikeCount: 2, Status: "visible", CreatedAt: now.Add(-2 * time.Minute)}
	comment2 := NoticeComment{NoticeID: noticeID, MachineID: "tagged", Content: "tagged comment", LikeCount: 0, Status: "visible", CreatedAt: now.Add(-1 * time.Minute)}
	comment3 := NoticeComment{NoticeID: noticeID, MachineID: "starred", Content: "starred comment", LikeCount: 0, Status: "visible", CreatedAt: now.Add(-3 * time.Minute)}
	for _, comment := range []*NoticeComment{&comment1, &comment2, &comment3} {
		if err := db.Create(comment).Error; err != nil {
			t.Fatalf("seed top comment: %v", err)
		}
	}

	replies := []NoticeComment{
		{NoticeID: noticeID, ParentID: comment2.ID, ReplyToID: comment2.ID, MachineID: "reply_user", Content: "reply one", LikeCount: 0, Status: "visible", CreatedAt: now.Add(-50 * time.Second)},
		{NoticeID: noticeID, ParentID: comment2.ID, MachineID: "normal", Content: "回复 @reply_user: legacy nested reply", LikeCount: 1, Status: "visible", CreatedAt: now.Add(-40 * time.Second)},
		{NoticeID: noticeID, ParentID: comment1.ID, MachineID: "reply_user", Content: "reply three", LikeCount: 0, Status: "visible", CreatedAt: now.Add(-30 * time.Second)},
	}
	for i := range replies {
		if err := db.Create(&replies[i]).Error; err != nil {
			t.Fatalf("seed reply %d: %v", i, err)
		}
	}

	if err := db.Create(&NoticeCommentLike{CommentID: comment1.ID, MachineID: "viewer"}).Error; err != nil {
		t.Fatalf("seed like: %v", err)
	}

	listResp := performRequest(router, http.MethodGet, "/notice-comments/11?machine_id=viewer&limit=2", nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("unexpected comment list status: %d body=%s", listResp.Code, listResp.Body.String())
	}

	var listPayload struct {
		Comments []struct {
			ID         uint    `json:"id"`
			ReplyCount int     `json:"reply_count"`
			Weight     float64 `json:"weight_score"`
			Liked      bool    `json:"liked"`
			Replies    []any   `json:"replies"`
			Nickname   string  `json:"nickname"`
			TopReplies []struct {
				ID              uint   `json:"id"`
				ReplyToUID      string `json:"reply_to_uid"`
				ReplyToNickname string `json:"reply_to_nickname"`
			} `json:"top_replies"`
			TagItems []struct {
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
			} `json:"tag_items"`
		} `json:"comments"`
		HasMore           bool `json:"has_more"`
		NextOffset        int  `json:"next_offset"`
		ShowWeightScore   bool `json:"show_weight_score"`
		CommentLimitChars int  `json:"comment_limit_chars"`
	}
	listPayload = decodeJSONBody[struct {
		Comments []struct {
			ID         uint    `json:"id"`
			ReplyCount int     `json:"reply_count"`
			Weight     float64 `json:"weight_score"`
			Liked      bool    `json:"liked"`
			Replies    []any   `json:"replies"`
			Nickname   string  `json:"nickname"`
			TopReplies []struct {
				ID              uint   `json:"id"`
				ReplyToUID      string `json:"reply_to_uid"`
				ReplyToNickname string `json:"reply_to_nickname"`
			} `json:"top_replies"`
			TagItems []struct {
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
			} `json:"tag_items"`
		} `json:"comments"`
		HasMore           bool `json:"has_more"`
		NextOffset        int  `json:"next_offset"`
		ShowWeightScore   bool `json:"show_weight_score"`
		CommentLimitChars int  `json:"comment_limit_chars"`
	}](t, listResp)

	if len(listPayload.Comments) != 2 {
		t.Fatalf("comment page size = %d, want 2", len(listPayload.Comments))
	}
	if listPayload.Comments[0].ID != comment2.ID || listPayload.Comments[1].ID != comment1.ID {
		t.Fatalf("unexpected comment order: %+v", listPayload.Comments)
	}
	if listPayload.Comments[0].ReplyCount != 2 || listPayload.Comments[1].ReplyCount != 1 {
		t.Fatalf("unexpected reply counts: %+v", listPayload.Comments)
	}
	if listPayload.Comments[0].Weight != 4 || listPayload.Comments[1].Weight != 3.5 {
		t.Fatalf("unexpected weights: %+v", listPayload.Comments)
	}
	if !listPayload.Comments[1].Liked {
		t.Fatalf("expected viewer like state on second comment")
	}
	if listPayload.Comments[0].Nickname != "TagHero" {
		t.Fatalf("comment nickname = %q, want %q", listPayload.Comments[0].Nickname, "TagHero")
	}
	if len(listPayload.Comments[0].TagItems) != 1 || listPayload.Comments[0].TagItems[0].Name != "sponsor_1" || listPayload.Comments[0].TagItems[0].DisplayName != "一级赞助者" {
		t.Fatalf("unexpected comment tag items: %+v", listPayload.Comments[0].TagItems)
	}
	if len(listPayload.Comments[0].Replies) != 0 {
		t.Fatalf("top comment page should not eagerly return replies")
	}
	if len(listPayload.Comments[0].TopReplies) != 2 {
		t.Fatalf("expected two top reply previews, got %+v", listPayload.Comments[0].TopReplies)
	}
	if listPayload.Comments[0].TopReplies[0].ReplyToUID != strconv.Itoa(int(users[5].ID)) {
		t.Fatalf("legacy top reply target uid = %q, want %d", listPayload.Comments[0].TopReplies[0].ReplyToUID, users[5].ID)
	}
	if listPayload.Comments[0].TopReplies[1].ReplyToUID != strconv.Itoa(int(users[3].ID)) {
		t.Fatalf("direct top reply target uid = %q, want %d", listPayload.Comments[0].TopReplies[1].ReplyToUID, users[3].ID)
	}
	if listPayload.Comments[0].TopReplies[1].ReplyToNickname != "TagHero" {
		t.Fatalf("direct top reply target nickname = %q, want %q", listPayload.Comments[0].TopReplies[1].ReplyToNickname, "TagHero")
	}
	if !listPayload.HasMore || listPayload.NextOffset != 2 {
		t.Fatalf("unexpected pagination payload: has_more=%v next_offset=%d", listPayload.HasMore, listPayload.NextOffset)
	}
	if listPayload.ShowWeightScore {
		t.Fatalf("normal viewer should not see weight score")
	}
	if listPayload.CommentLimitChars != 200 {
		t.Fatalf("normal viewer comment limit = %d, want 200", listPayload.CommentLimitChars)
	}

	adminResp := performRequest(router, http.MethodGet, "/notice-comments/11?machine_id=admin_viewer&limit=1", nil)
	if adminResp.Code != http.StatusOK {
		t.Fatalf("unexpected admin comment list status: %d body=%s", adminResp.Code, adminResp.Body.String())
	}
	var adminPayload struct {
		ShowWeightScore   bool `json:"show_weight_score"`
		CommentLimitChars int  `json:"comment_limit_chars"`
	}
	adminPayload = decodeJSONBody[struct {
		ShowWeightScore   bool `json:"show_weight_score"`
		CommentLimitChars int  `json:"comment_limit_chars"`
	}](t, adminResp)
	if !adminPayload.ShowWeightScore {
		t.Fatalf("admin viewer should see weight score")
	}
	if adminPayload.CommentLimitChars != 320 {
		t.Fatalf("admin viewer comment limit = %d, want 320", adminPayload.CommentLimitChars)
	}

	replyResp := performRequest(router, http.MethodGet, "/notice-comments/11/replies/"+strconv.Itoa(int(comment2.ID))+"?machine_id=viewer", nil)
	if replyResp.Code != http.StatusOK {
		t.Fatalf("unexpected replies status: %d body=%s", replyResp.Code, replyResp.Body.String())
	}

	var replyPayload struct {
		ReplyCount int `json:"reply_count"`
		Replies    []struct {
			ID              uint   `json:"id"`
			ParentID        uint   `json:"parent_id"`
			ReplyToUID      string `json:"reply_to_uid"`
			ReplyToNickname string `json:"reply_to_nickname"`
			CanDelete       bool   `json:"can_delete"`
			IsSelf          bool   `json:"is_self"`
		} `json:"replies"`
	}
	replyPayload = decodeJSONBody[struct {
		ReplyCount int `json:"reply_count"`
		Replies    []struct {
			ID              uint   `json:"id"`
			ParentID        uint   `json:"parent_id"`
			ReplyToUID      string `json:"reply_to_uid"`
			ReplyToNickname string `json:"reply_to_nickname"`
			CanDelete       bool   `json:"can_delete"`
			IsSelf          bool   `json:"is_self"`
		} `json:"replies"`
	}](t, replyResp)

	if replyPayload.ReplyCount != 2 || len(replyPayload.Replies) != 2 {
		t.Fatalf("unexpected reply payload: %+v", replyPayload)
	}
	for _, reply := range replyPayload.Replies {
		if reply.ParentID != comment2.ID {
			t.Fatalf("reply %d belongs to unexpected parent %d", reply.ID, reply.ParentID)
		}
	}
	if replyPayload.Replies[0].ReplyToUID != strconv.Itoa(int(users[3].ID)) {
		t.Fatalf("first reply target uid = %q, want %d", replyPayload.Replies[0].ReplyToUID, users[3].ID)
	}
	if replyPayload.Replies[0].ReplyToNickname != "TagHero" {
		t.Fatalf("first reply target nickname = %q, want %q", replyPayload.Replies[0].ReplyToNickname, "TagHero")
	}
	if replyPayload.Replies[1].ReplyToUID != strconv.Itoa(int(users[5].ID)) {
		t.Fatalf("legacy reply target uid = %q, want %d", replyPayload.Replies[1].ReplyToUID, users[5].ID)
	}
	if replyPayload.Replies[0].CanDelete || replyPayload.Replies[0].IsSelf {
		t.Fatalf("viewer should not be able to delete others reply: %+v", replyPayload.Replies[0])
	}

	page2Resp := performRequest(router, http.MethodGet, "/notice-comments/11?machine_id=viewer&limit=2&offset=2", nil)
	if page2Resp.Code != http.StatusOK {
		t.Fatalf("unexpected second page status: %d body=%s", page2Resp.Code, page2Resp.Body.String())
	}
	var page2Payload struct {
		Comments []struct {
			ID        uint `json:"id"`
			IsStarred bool `json:"is_starred"`
		} `json:"comments"`
		HasMore bool `json:"has_more"`
	}
	page2Payload = decodeJSONBody[struct {
		Comments []struct {
			ID        uint `json:"id"`
			IsStarred bool `json:"is_starred"`
		} `json:"comments"`
		HasMore bool `json:"has_more"`
	}](t, page2Resp)

	if len(page2Payload.Comments) != 1 || page2Payload.Comments[0].ID != comment3.ID || page2Payload.HasMore {
		t.Fatalf("unexpected second page payload: %+v", page2Payload)
	}
	if !page2Payload.Comments[0].IsStarred {
		t.Fatalf("expected starred flag on second page comment")
	}
}

func TestNoticeCommentPostRespectsGroupCharacterLimit(t *testing.T) {
	setupCommunityTestDB(t)
	router := setupCommunityTestRouter()
	prevSecret := clientAuthSecret
	clientAuthSecret = "community-test-secret"
	testClientDeviceTokens = sync.Map{}
	defer func() {
		clientAuthSecret = prevSecret
	}()

	if err := SaveCommentWeightConfig(CommentWeightConfig{
		BaseUserWeight:       1,
		StarredUserWeight:    0,
		AdminUserWeight:      0,
		BaseUserCommentLimit: 12,
		StarredCommentLimit:  20,
		AdminCommentLimit:    30,
		TagWeights:           map[string]float64{},
	}); err != nil {
		t.Fatalf("save config: %v", err)
	}

	users := []TelemetryRecord{
		{MachineID: "normal_user", Alias: "normal_user"},
		{MachineID: "starred_user", Alias: "starred_user", IsStarred: true},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("seed user %d: %v", i, err)
		}
	}

	tooLongForNormal := performSignedCommunityRequest(router, http.MethodPost, "/notice-comment", gin.H{
		"notice_id":  66,
		"machine_id": "normal_user",
		"content":    "1234567890123",
		"parent_id":  0,
	}, "normal_user")
	if tooLongForNormal.Code != http.StatusBadRequest {
		t.Fatalf("normal user over-limit status = %d body=%s", tooLongForNormal.Code, tooLongForNormal.Body.String())
	}

	okForStarred := performSignedCommunityRequest(router, http.MethodPost, "/notice-comment", gin.H{
		"notice_id":  66,
		"machine_id": "starred_user",
		"content":    "1234567890123",
		"parent_id":  0,
	}, "starred_user")
	if okForStarred.Code != http.StatusOK {
		t.Fatalf("starred user post status = %d body=%s", okForStarred.Code, okForStarred.Body.String())
	}
}

func TestNoticeCommentPostRateLimitUsesConfiguredWindow(t *testing.T) {
	setupCommunityTestDB(t)
	router := setupCommunityTestRouter()
	prevSecret := clientAuthSecret
	clientAuthSecret = "community-rate-secret"
	testClientDeviceTokens = sync.Map{}
	defer func() {
		clientAuthSecret = prevSecret
	}()

	if err := SaveCommentWeightConfig(CommentWeightConfig{
		BaseUserWeight:       1,
		StarredUserWeight:    0,
		AdminUserWeight:      0,
		BaseUserCommentLimit: 200,
		StarredCommentLimit:  200,
		AdminCommentLimit:    200,
		CommentRateWindow:    60,
		CommentRateMax:       5,
		TagWeights:           map[string]float64{},
	}); err != nil {
		t.Fatalf("save config: %v", err)
	}

	user := TelemetryRecord{MachineID: "rate_user", Alias: "rate_user"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("seed user: %v", err)
	}

	for i := 0; i < 5; i++ {
		resp := performSignedCommunityRequest(router, http.MethodPost, "/notice-comment", gin.H{
			"notice_id":  99,
			"machine_id": "rate_user",
			"content":    "comment " + strconv.Itoa(i+1),
			"parent_id":  0,
		}, "rate_user")
		if resp.Code != http.StatusOK {
			t.Fatalf("post %d status = %d body=%s", i+1, resp.Code, resp.Body.String())
		}
	}

	limited := performSignedCommunityRequest(router, http.MethodPost, "/notice-comment", gin.H{
		"notice_id":  99,
		"machine_id": "rate_user",
		"content":    "comment 6",
		"parent_id":  0,
	}, "rate_user")
	if limited.Code != http.StatusTooManyRequests {
		t.Fatalf("6th comment status = %d body=%s", limited.Code, limited.Body.String())
	}
	var limitedPayload struct {
		Error string `json:"error"`
	}
	limitedPayload = decodeJSONBody[struct {
		Error string `json:"error"`
	}](t, limited)
	if limitedPayload.Error != "发送太频繁，60 秒内最多发送 5 条" {
		t.Fatalf("unexpected rate limit error: %+v", limitedPayload)
	}

	if err := db.Model(&NoticeComment{}).
		Where("notice_id = ? AND machine_id = ?", 99, "rate_user").
		Update("created_at", time.Now().Add(-2*time.Minute)).Error; err != nil {
		t.Fatalf("age comments: %v", err)
	}

	recovered := performSignedCommunityRequest(router, http.MethodPost, "/notice-comment", gin.H{
		"notice_id":  99,
		"machine_id": "rate_user",
		"content":    "comment after reset",
		"parent_id":  0,
	}, "rate_user")
	if recovered.Code != http.StatusOK {
		t.Fatalf("post after rate window reset status = %d body=%s", recovered.Code, recovered.Body.String())
	}
}

func TestNoticeCommentLikeToggle(t *testing.T) {
	setupCommunityTestDB(t)
	router := setupCommunityTestRouter()
	prevSecret := clientAuthSecret
	clientAuthSecret = "community-like-secret"
	testClientDeviceTokens = sync.Map{}
	defer func() {
		clientAuthSecret = prevSecret
	}()

	users := []TelemetryRecord{
		{MachineID: "viewer", Alias: "viewer"},
		{MachineID: "author", Alias: "author"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("seed user %d: %v", i, err)
		}
	}

	comment := NoticeComment{NoticeID: 77, MachineID: "author", Content: "hello", Status: "visible"}
	if err := db.Create(&comment).Error; err != nil {
		t.Fatalf("seed comment: %v", err)
	}

	likeResp := performSignedCommunityRequest(router, http.MethodPost, "/notice-comment-like", gin.H{
		"comment_id": comment.ID,
		"machine_id": "viewer",
	}, "viewer")
	if likeResp.Code != http.StatusOK {
		t.Fatalf("like status = %d body=%s", likeResp.Code, likeResp.Body.String())
	}
	var likePayload struct {
		Status    string `json:"status"`
		Liked     bool   `json:"liked"`
		LikeCount int    `json:"like_count"`
	}
	likePayload = decodeJSONBody[struct {
		Status    string `json:"status"`
		Liked     bool   `json:"liked"`
		LikeCount int    `json:"like_count"`
	}](t, likeResp)
	if likePayload.Status != "liked" || !likePayload.Liked || likePayload.LikeCount != 1 {
		t.Fatalf("unexpected like payload: %+v", likePayload)
	}

	var reloaded NoticeComment
	if err := db.First(&reloaded, comment.ID).Error; err != nil {
		t.Fatalf("reload liked comment: %v", err)
	}
	if reloaded.LikeCount != 1 {
		t.Fatalf("persisted like_count = %d, want 1", reloaded.LikeCount)
	}

	unlikeResp := performSignedCommunityRequest(router, http.MethodPost, "/notice-comment-like", gin.H{
		"comment_id": comment.ID,
		"machine_id": "viewer",
	}, "viewer")
	if unlikeResp.Code != http.StatusOK {
		t.Fatalf("unlike status = %d body=%s", unlikeResp.Code, unlikeResp.Body.String())
	}
	var unlikePayload struct {
		Status    string `json:"status"`
		Liked     bool   `json:"liked"`
		LikeCount int    `json:"like_count"`
	}
	unlikePayload = decodeJSONBody[struct {
		Status    string `json:"status"`
		Liked     bool   `json:"liked"`
		LikeCount int    `json:"like_count"`
	}](t, unlikeResp)
	if unlikePayload.Status != "unliked" || unlikePayload.Liked || unlikePayload.LikeCount != 0 {
		t.Fatalf("unexpected unlike payload: %+v", unlikePayload)
	}

	if err := db.First(&reloaded, comment.ID).Error; err != nil {
		t.Fatalf("reload unliked comment: %v", err)
	}
	if reloaded.LikeCount != 0 {
		t.Fatalf("persisted like_count after unlike = %d, want 0", reloaded.LikeCount)
	}
}

func TestNoticeCommentClientModerationRoutes(t *testing.T) {
	setupCommunityTestDB(t)
	router := setupCommunityTestRouter()
	prevSecret := clientAuthSecret
	clientAuthSecret = "community-moderation-secret"
	testClientDeviceTokens = sync.Map{}
	defer func() {
		clientAuthSecret = prevSecret
	}()

	users := []TelemetryRecord{
		{MachineID: "admin_user", Alias: "admin_user", IsAdmin: true},
		{MachineID: "author_user", Alias: "author_user", CommentPerms: `{"can_delete_others":true,"can_pin_comment":true,"can_ban_user":true}`},
		{MachineID: "other_user", Alias: "other_user"},
	}
	for i := range users {
		if err := db.Create(&users[i]).Error; err != nil {
			t.Fatalf("seed user %d: %v", i, err)
		}
	}

	now := time.Now()
	ownComment := NoticeComment{NoticeID: 88, MachineID: "author_user", Content: "own comment", Status: "visible", CreatedAt: now.Add(-2 * time.Minute)}
	ownReply := NoticeComment{NoticeID: 88, ParentID: 0, MachineID: "author_user", Content: "placeholder", Status: "visible", CreatedAt: now.Add(-90 * time.Second)}
	adminTarget := NoticeComment{NoticeID: 88, MachineID: "other_user", Content: "other comment", Status: "visible", CreatedAt: now.Add(-1 * time.Minute)}
	for _, comment := range []*NoticeComment{&ownComment, &ownReply, &adminTarget} {
		if err := db.Create(comment).Error; err != nil {
			t.Fatalf("seed comment: %v", err)
		}
	}
	threadReply := NoticeComment{NoticeID: 88, ParentID: ownComment.ID, ReplyToID: ownComment.ID, MachineID: "other_user", Content: "reply to own", Status: "visible", CreatedAt: now.Add(-30 * time.Second)}
	if err := db.Create(&threadReply).Error; err != nil {
		t.Fatalf("seed thread reply: %v", err)
	}
	foreignTop := NoticeComment{NoticeID: 88, MachineID: "other_user", Content: "foreign thread", Status: "visible", CreatedAt: now.Add(-20 * time.Second)}
	if err := db.Create(&foreignTop).Error; err != nil {
		t.Fatalf("seed foreign top: %v", err)
	}
	ownChildReply := NoticeComment{NoticeID: 88, ParentID: foreignTop.ID, ReplyToID: foreignTop.ID, MachineID: "author_user", Content: "own child reply", Status: "visible", CreatedAt: now.Add(-10 * time.Second)}
	if err := db.Create(&ownChildReply).Error; err != nil {
		t.Fatalf("seed own child reply: %v", err)
	}

	deleteResp := performSignedCommunityRequestWithRoute(
		router,
		http.MethodDelete,
		"/notice-comments/"+strconv.Itoa(int(ownComment.ID))+"?machine_id=author_user",
		"/notice-comments/"+strconv.Itoa(int(ownComment.ID)),
		nil,
		"author_user",
	)
	if deleteResp.Code != http.StatusOK {
		t.Fatalf("author delete own comment status = %d body=%s", deleteResp.Code, deleteResp.Body.String())
	}
	var deletedCount int64
	db.Model(&NoticeComment{}).Where("id IN ?", []uint{ownComment.ID, threadReply.ID}).Count(&deletedCount)
	if deletedCount != 0 {
		t.Fatalf("expected own comment thread to be deleted, remaining=%d", deletedCount)
	}

	forbiddenDelete := performSignedCommunityRequestWithRoute(
		router,
		http.MethodDelete,
		"/notice-comments/"+strconv.Itoa(int(adminTarget.ID))+"?machine_id=author_user",
		"/notice-comments/"+strconv.Itoa(int(adminTarget.ID)),
		nil,
		"author_user",
	)
	if forbiddenDelete.Code != http.StatusForbidden {
		t.Fatalf("delete others comment status = %d body=%s", forbiddenDelete.Code, forbiddenDelete.Body.String())
	}

	listRespWithPerm := performRequest(router, http.MethodGet, "/notice-comments/88?machine_id=author_user", nil)
	if listRespWithPerm.Code != http.StatusOK {
		t.Fatalf("author list status = %d body=%s", listRespWithPerm.Code, listRespWithPerm.Body.String())
	}
	var authorListPayload struct {
		Comments []struct {
			ID        uint `json:"id"`
			CanDelete bool `json:"can_delete"`
			IsSelf    bool `json:"is_self"`
		} `json:"comments"`
	}
	authorListPayload = decodeJSONBody[struct {
		Comments []struct {
			ID        uint `json:"id"`
			CanDelete bool `json:"can_delete"`
			IsSelf    bool `json:"is_self"`
		} `json:"comments"`
	}](t, listRespWithPerm)
	for _, item := range authorListPayload.Comments {
		if item.ID == adminTarget.ID && (item.CanDelete || item.IsSelf) {
			t.Fatalf("non-admin should not be able to moderate others top comment: %+v", item)
		}
	}

	ownReplyListResp := performRequest(router, http.MethodGet, "/notice-comments/88/replies/"+strconv.Itoa(int(foreignTop.ID))+"?machine_id=author_user", nil)
	if ownReplyListResp.Code != http.StatusOK {
		t.Fatalf("own reply list status = %d body=%s", ownReplyListResp.Code, ownReplyListResp.Body.String())
	}
	var ownReplyListPayload struct {
		Replies []struct {
			ID        uint `json:"id"`
			CanDelete bool `json:"can_delete"`
			IsSelf    bool `json:"is_self"`
		} `json:"replies"`
	}
	ownReplyListPayload = decodeJSONBody[struct {
		Replies []struct {
			ID        uint `json:"id"`
			CanDelete bool `json:"can_delete"`
			IsSelf    bool `json:"is_self"`
		} `json:"replies"`
	}](t, ownReplyListResp)
	foundOwnReply := false
	for _, item := range ownReplyListPayload.Replies {
		if item.ID == ownChildReply.ID {
			foundOwnReply = true
			if !item.CanDelete || !item.IsSelf {
				t.Fatalf("author should be able to delete own child reply: %+v", item)
			}
			continue
		}
		if item.CanDelete || item.IsSelf {
			t.Fatalf("author should not be able to delete others child reply: %+v", item)
		}
	}
	if !foundOwnReply {
		t.Fatalf("own child reply %d not found in reply list", ownChildReply.ID)
	}

	deleteOwnReplyResp := performSignedCommunityRequestWithRoute(
		router,
		http.MethodDelete,
		"/notice-comments/"+strconv.Itoa(int(ownChildReply.ID))+"?machine_id=author_user",
		"/notice-comments/"+strconv.Itoa(int(ownChildReply.ID)),
		nil,
		"author_user",
	)
	if deleteOwnReplyResp.Code != http.StatusOK {
		t.Fatalf("author delete own child reply status = %d body=%s", deleteOwnReplyResp.Code, deleteOwnReplyResp.Body.String())
	}
	var ownReplyDeletedCount int64
	db.Model(&NoticeComment{}).Where("id = ?", ownChildReply.ID).Count(&ownReplyDeletedCount)
	if ownReplyDeletedCount != 0 {
		t.Fatalf("expected own child reply to be deleted, remaining=%d", ownReplyDeletedCount)
	}

	reportOtherResp := performSignedCommunityRequest(
		router,
		http.MethodPost,
		"/notice-comment-report",
		gin.H{
			"comment_id":  adminTarget.ID,
			"machine_id":  "author_user",
			"report_type": "spam",
			"reason":      "test report",
		},
		"author_user",
	)
	if reportOtherResp.Code != http.StatusOK {
		t.Fatalf("report others status = %d body=%s", reportOtherResp.Code, reportOtherResp.Body.String())
	}

	reportSelfResp := performSignedCommunityRequest(
		router,
		http.MethodPost,
		"/notice-comment-report",
		gin.H{
			"comment_id":  ownReply.ID,
			"machine_id":  "author_user",
			"report_type": "spam",
			"reason":      "should fail",
		},
		"author_user",
	)
	if reportSelfResp.Code != http.StatusForbidden {
		t.Fatalf("self report status = %d body=%s", reportSelfResp.Code, reportSelfResp.Body.String())
	}

	weightResp := performSignedCommunityRequest(
		router,
		http.MethodPost,
		"/notice-comments/"+strconv.Itoa(int(adminTarget.ID))+"/weight",
		gin.H{
			"machine_id": "admin_user",
			"action":     "increase",
			"amount":     2,
		},
		"admin_user",
	)
	if weightResp.Code != http.StatusOK {
		t.Fatalf("admin weight status = %d body=%s", weightResp.Code, weightResp.Body.String())
	}
	var updatedTarget NoticeComment
	if err := db.First(&updatedTarget, adminTarget.ID).Error; err != nil {
		t.Fatalf("reload target: %v", err)
	}
	if updatedTarget.WeightAdjustment != 2 {
		t.Fatalf("weight adjustment = %v, want 2", updatedTarget.WeightAdjustment)
	}

	banResp := performSignedCommunityRequest(
		router,
		http.MethodPost,
		"/notice-comments/"+strconv.Itoa(int(adminTarget.ID))+"/ban",
		gin.H{
			"machine_id":     "admin_user",
			"duration_value": 2,
			"duration_unit":  "hour",
			"reason":         "测试封禁",
		},
		"admin_user",
	)
	if banResp.Code != http.StatusOK {
		t.Fatalf("admin ban status = %d body=%s", banResp.Code, banResp.Body.String())
	}

	ban := getNoticeCommentBan("other_user")
	if ban == nil || ban.ExpiresAt == nil || ban.Reason != "测试封禁" {
		t.Fatalf("unexpected active ban: %+v", ban)
	}

	listResp := performRequest(router, http.MethodGet, "/notice-comments/88?machine_id=other_user", nil)
	if listResp.Code != http.StatusOK {
		t.Fatalf("banned user list status = %d body=%s", listResp.Code, listResp.Body.String())
	}
	var listPayload struct {
		CanComment   bool   `json:"can_comment"`
		BanReason    string `json:"ban_reason"`
		BanExpiresAt string `json:"ban_expires_at"`
	}
	listPayload = decodeJSONBody[struct {
		CanComment   bool   `json:"can_comment"`
		BanReason    string `json:"ban_reason"`
		BanExpiresAt string `json:"ban_expires_at"`
	}](t, listResp)
	if listPayload.CanComment || listPayload.BanReason != "测试封禁" || listPayload.BanExpiresAt == "" {
		t.Fatalf("unexpected banned viewer payload: %+v", listPayload)
	}
}

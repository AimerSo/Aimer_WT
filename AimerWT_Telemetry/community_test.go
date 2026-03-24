package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
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
		&UserTag{},
		&NoticeComment{},
		&NoticeCommentLike{},
		&NoticeCommentBan{},
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
	if len(initial.Tags) != 1 || initial.Tags[0].Name != "sponsor_1" {
		t.Fatalf("unexpected tags payload: %+v", initial.Tags)
	}

	payload := CommentWeightConfig{
		BaseUserWeight:    1.5,
		StarredUserWeight: 0.5,
		AdminUserWeight:   1,
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
}

func TestNoticeCommentsPaginationAndReplies(t *testing.T) {
	setupCommunityTestDB(t)
	router := setupCommunityTestRouter()

	if err := SaveCommentWeightConfig(CommentWeightConfig{
		BaseUserWeight:    1,
		StarredUserWeight: 0.5,
		AdminUserWeight:   0,
		TagWeights: map[string]float64{
			"sponsor_1": 1,
		},
	}); err != nil {
		t.Fatalf("save weight config: %v", err)
	}

	users := []TelemetryRecord{
		{MachineID: "viewer", Alias: "viewer"},
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
		{NoticeID: noticeID, ParentID: comment2.ID, MachineID: "reply_user", Content: "reply one", LikeCount: 0, Status: "visible", CreatedAt: now.Add(-50 * time.Second)},
		{NoticeID: noticeID, ParentID: comment2.ID, MachineID: "normal", Content: "reply two", LikeCount: 1, Status: "visible", CreatedAt: now.Add(-40 * time.Second)},
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
		} `json:"comments"`
		HasMore    bool `json:"has_more"`
		NextOffset int  `json:"next_offset"`
	}
	listPayload = decodeJSONBody[struct {
		Comments []struct {
			ID         uint    `json:"id"`
			ReplyCount int     `json:"reply_count"`
			Weight     float64 `json:"weight_score"`
			Liked      bool    `json:"liked"`
			Replies    []any   `json:"replies"`
		} `json:"comments"`
		HasMore    bool `json:"has_more"`
		NextOffset int  `json:"next_offset"`
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
	if len(listPayload.Comments[0].Replies) != 0 {
		t.Fatalf("top comment page should not eagerly return replies")
	}
	if !listPayload.HasMore || listPayload.NextOffset != 2 {
		t.Fatalf("unexpected pagination payload: has_more=%v next_offset=%d", listPayload.HasMore, listPayload.NextOffset)
	}

	replyResp := performRequest(router, http.MethodGet, "/notice-comments/11/replies/"+strconv.Itoa(int(comment2.ID))+"?machine_id=viewer", nil)
	if replyResp.Code != http.StatusOK {
		t.Fatalf("unexpected replies status: %d body=%s", replyResp.Code, replyResp.Body.String())
	}

	var replyPayload struct {
		ReplyCount int `json:"reply_count"`
		Replies    []struct {
			ID       uint `json:"id"`
			ParentID uint `json:"parent_id"`
		} `json:"replies"`
	}
	replyPayload = decodeJSONBody[struct {
		ReplyCount int `json:"reply_count"`
		Replies    []struct {
			ID       uint `json:"id"`
			ParentID uint `json:"parent_id"`
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

	page2Resp := performRequest(router, http.MethodGet, "/notice-comments/11?machine_id=viewer&limit=2&offset=2", nil)
	if page2Resp.Code != http.StatusOK {
		t.Fatalf("unexpected second page status: %d body=%s", page2Resp.Code, page2Resp.Body.String())
	}
	var page2Payload struct {
		Comments []struct {
			ID uint `json:"id"`
		} `json:"comments"`
		HasMore bool `json:"has_more"`
	}
	page2Payload = decodeJSONBody[struct {
		Comments []struct {
			ID uint `json:"id"`
		} `json:"comments"`
		HasMore bool `json:"has_more"`
	}](t, page2Resp)

	if len(page2Payload.Comments) != 1 || page2Payload.Comments[0].ID != comment3.ID || page2Payload.HasMore {
		t.Fatalf("unexpected second page payload: %+v", page2Payload)
	}
}

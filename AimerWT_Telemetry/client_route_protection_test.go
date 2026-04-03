package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupClientRouteProtectionDB(t *testing.T) {
	t.Helper()
	testClientDeviceTokens = sync.Map{}

	var err error
	db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "client_route_protection.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	if err := db.AutoMigrate(
		&ContentConfig{},
		&ClientDeviceToken{},
		&TelemetryRecord{},
		&NoticeItem{},
		&NoticeReaction{},
		&NoticeComment{},
		&NoticeCommentLike{},
		&NoticeCommentBan{},
		&UserProfile{},
		&NicknameRequest{},
	); err != nil {
		t.Fatalf("auto migrate: %v", err)
	}
}

func TestNoticeCommentReadRoutesRequireClientOrAdminAuth(t *testing.T) {
	setupClientRouteProtectionDB(t)
	gin.SetMode(gin.TestMode)

	prevAdminUser := adminUser
	prevAdminPass := adminPass
	prevSecret := clientAuthSecret
	prevSysConfig := sysConfig
	adminUser = "admin-test"
	adminPass = "pass-test"
	clientAuthSecret = "route-test-secret"
	sysConfig = SystemConfig{
		BadgeSystemEnabled:    true,
		NicknameChangeEnabled: true,
		AvatarUploadEnabled:   true,
		NoticeCommentEnabled:  true,
		NoticeReactionEnabled: true,
		RedeemCodeEnabled:     true,
		FeedbackEnabled:       true,
	}
	defer func() {
		adminUser = prevAdminUser
		adminPass = prevAdminPass
		clientAuthSecret = prevSecret
		sysConfig = prevSysConfig
	}()

	router := gin.New()
	initRouter(router)

	anonymousReq := httptest.NewRequest(http.MethodGet, "/notice-comments/1", nil)
	anonymousResp := httptest.NewRecorder()
	router.ServeHTTP(anonymousResp, anonymousReq)
	if anonymousResp.Code != http.StatusForbidden {
		t.Fatalf("expected anonymous request to be forbidden, got %d body=%s", anonymousResp.Code, anonymousResp.Body.String())
	}

	adminReq := httptest.NewRequest(http.MethodGet, "/notice-comments/1", nil)
	adminReq.SetBasicAuth(adminUser, adminPass)
	adminResp := httptest.NewRecorder()
	router.ServeHTTP(adminResp, adminReq)
	if adminResp.Code == http.StatusForbidden {
		t.Fatalf("expected admin-authenticated request not to be forbidden")
	}

	clientReq := httptest.NewRequest(http.MethodGet, "/notice-comments/1?machine_id=user-a", nil)
	for key, value := range buildSignedTestHeaders("/notice-comments/1", http.MethodGet, "user-a", clientAuthSecret) {
		clientReq.Header.Set(key, value)
	}
	clientResp := httptest.NewRecorder()
	router.ServeHTTP(clientResp, clientReq)
	if clientResp.Code == http.StatusForbidden {
		t.Fatalf("expected signed client request not to be forbidden")
	}
}

func TestNoticeReactionRoutesPersistSingleReactionPerUser(t *testing.T) {
	setupClientRouteProtectionDB(t)
	gin.SetMode(gin.TestMode)

	prevAdminUser := adminUser
	prevAdminPass := adminPass
	prevSecret := clientAuthSecret
	prevSysConfig := sysConfig
	adminUser = "admin-test"
	adminPass = "pass-test"
	clientAuthSecret = "reaction-route-secret"
	sysConfig = SystemConfig{
		BadgeSystemEnabled:    true,
		NicknameChangeEnabled: true,
		AvatarUploadEnabled:   true,
		NoticeCommentEnabled:  true,
		NoticeReactionEnabled: true,
		RedeemCodeEnabled:     true,
		FeedbackEnabled:       true,
	}
	defer func() {
		adminUser = prevAdminUser
		adminPass = prevAdminPass
		clientAuthSecret = prevSecret
		sysConfig = prevSysConfig
	}()

	if err := db.Create(&TelemetryRecord{MachineID: "reactor", Alias: "reactor"}).Error; err != nil {
		t.Fatalf("seed reactor: %v", err)
	}

	router := gin.New()
	initRouter(router)

	postReaction := func(emoji string) *httptest.ResponseRecorder {
		return performSecurityJSONRequest(router, http.MethodPost, "/notice-reaction", map[string]any{
			"notice_id":  55,
			"machine_id": "reactor",
			"emoji":      emoji,
		}, buildSignedTestHeaders("/notice-reaction", http.MethodPost, "reactor", clientAuthSecret))
	}

	loadReactions := func() struct {
		Reactions []struct {
			Emoji   string `json:"emoji"`
			Count   int    `json:"count"`
			Reacted bool   `json:"reacted"`
		} `json:"reactions"`
	} {
		resp := performSecurityJSONRequest(
			router,
			http.MethodGet,
			"/notice-reactions/55?machine_id=reactor",
			nil,
			buildSignedTestHeaders("/notice-reactions/55", http.MethodGet, "reactor", clientAuthSecret),
		)
		if resp.Code != http.StatusOK {
			t.Fatalf("load reactions status = %d body=%s", resp.Code, resp.Body.String())
		}
		return decodeJSONBody[struct {
			Reactions []struct {
				Emoji   string `json:"emoji"`
				Count   int    `json:"count"`
				Reacted bool   `json:"reacted"`
			} `json:"reactions"`
		}](t, resp)
	}

	addResp := postReaction("😀")
	if addResp.Code != http.StatusOK {
		t.Fatalf("add reaction status = %d body=%s", addResp.Code, addResp.Body.String())
	}
	var addPayload struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(addResp.Body.Bytes(), &addPayload); err != nil {
		t.Fatalf("decode add payload: %v", err)
	}
	if addPayload.Status != "added" {
		t.Fatalf("unexpected add payload: %+v", addPayload)
	}

	reactions := loadReactions()
	if len(reactions.Reactions) != 1 || reactions.Reactions[0].Emoji != "😀" || reactions.Reactions[0].Count != 1 || !reactions.Reactions[0].Reacted {
		t.Fatalf("unexpected reactions after add: %+v", reactions.Reactions)
	}

	removeResp := postReaction("😀")
	if removeResp.Code != http.StatusOK {
		t.Fatalf("remove reaction status = %d body=%s", removeResp.Code, removeResp.Body.String())
	}
	var removePayload struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(removeResp.Body.Bytes(), &removePayload); err != nil {
		t.Fatalf("decode remove payload: %v", err)
	}
	if removePayload.Status != "removed" {
		t.Fatalf("unexpected remove payload: %+v", removePayload)
	}

	reactions = loadReactions()
	if len(reactions.Reactions) != 0 {
		t.Fatalf("expected no reactions after toggle-off, got %+v", reactions.Reactions)
	}

	if resp := postReaction("❤️"); resp.Code != http.StatusOK {
		t.Fatalf("add first replacement reaction status = %d body=%s", resp.Code, resp.Body.String())
	}
	replaceResp := postReaction("😀")
	if replaceResp.Code != http.StatusOK {
		t.Fatalf("replace reaction status = %d body=%s", replaceResp.Code, replaceResp.Body.String())
	}
	var replacePayload struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(replaceResp.Body.Bytes(), &replacePayload); err != nil {
		t.Fatalf("decode replace payload: %v", err)
	}
	if replacePayload.Status != "replaced" {
		t.Fatalf("unexpected replace payload: %+v", replacePayload)
	}

	reactions = loadReactions()
	if len(reactions.Reactions) != 1 || reactions.Reactions[0].Emoji != "😀" || reactions.Reactions[0].Count != 1 || !reactions.Reactions[0].Reacted {
		t.Fatalf("unexpected reactions after replace: %+v", reactions.Reactions)
	}

	var persistedCount int64
	if err := db.Model(&NoticeReaction{}).Where("notice_id = ? AND machine_id = ?", 55, "reactor").Count(&persistedCount).Error; err != nil {
		t.Fatalf("count persisted reactions: %v", err)
	}
	if persistedCount != 1 {
		t.Fatalf("persisted reaction rows = %d, want 1", persistedCount)
	}
}

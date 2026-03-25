package main

import (
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

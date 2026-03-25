package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

var testClientDeviceTokens sync.Map
var testClientDeviceTokenMu sync.Mutex

func setupUserProfileTestDB(t *testing.T) {
	t.Helper()
	testClientDeviceTokens = sync.Map{}

	var err error
	db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "user_profile_test.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db handle: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if _, err := sqlDB.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		t.Fatalf("set wal: %v", err)
	}
	if _, err := sqlDB.Exec("PRAGMA busy_timeout = 5000;"); err != nil {
		t.Fatalf("set busy_timeout: %v", err)
	}

	if err := db.AutoMigrate(&ContentConfig{}, &TelemetryRecord{}, &ClientDeviceToken{}, &UserProfile{}, &NicknameRequest{}); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}
}

func getOrIssueTestDeviceToken(t *testing.T, machineID string) string {
	t.Helper()
	normalized := strings.TrimSpace(machineID)
	if normalized == "" {
		return ""
	}
	if existing, ok := testClientDeviceTokens.Load(normalized); ok {
		return existing.(string)
	}
	token, err := issueClientDeviceToken(normalized)
	if err != nil {
		t.Fatalf("issue device token for %s: %v", normalized, err)
	}
	testClientDeviceTokens.Store(normalized, token)
	return token
}

func buildSignedTestHeaders(path, method, machineID, secret string) map[string]string {
	headers := buildSignedTestHeadersWithoutDeviceToken(path, method, machineID, secret)
	if machineID != "" {
		testClientDeviceTokenMu.Lock()
		if existing, ok := testClientDeviceTokens.Load(machineID); ok {
			headers[clientDeviceTokenHeader] = existing.(string)
		} else {
			token, err := issueClientDeviceToken(machineID)
			if err != nil {
				testClientDeviceTokenMu.Unlock()
				panic(err)
			}
			testClientDeviceTokens.Store(machineID, token)
			headers[clientDeviceTokenHeader] = token
		}
		testClientDeviceTokenMu.Unlock()
	}
	return headers
}

func buildSignedTestHeadersWithoutDeviceToken(path, method, machineID, secret string) map[string]string {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	canonical := method + "\n" + path + "\n" + machineID + "\n" + timestamp
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	signature := hex.EncodeToString(mac.Sum(nil))

	return map[string]string{
		"X-AimerWT-Client":    "1",
		"X-AimerWT-Timestamp": timestamp,
		"X-AimerWT-Machine":   machineID,
		"X-AimerWT-Signature": signature,
	}
}

func performProfileRequest(r http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	var payload []byte
	if body != nil {
		payload, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(payload))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func TestUserProfileClientRoutesRequireAuthAndBinding(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	previousSecret := clientAuthSecret
	clientAuthSecret = "unit-test-secret"
	defer func() {
		clientAuthSecret = previousSecret
	}()

	router := gin.New()
	router.Use(func(c *gin.Context) {
		if c.Request.URL.Path == "/user-profile" {
			if !requireClientRequest(c) {
				return
			}
		}
		c.Next()
	})
	initUserProfileClientRoutes(router)

	unauthorized := performProfileRequest(router, http.MethodGet, "/user-profile?machine_id=user-a", nil, nil)
	if unauthorized.Code != http.StatusForbidden {
		t.Fatalf("expected unauthorized GET to be forbidden, got %d", unauthorized.Code)
	}

	headers := buildSignedTestHeaders("/user-profile", http.MethodGet, "user-a", clientAuthSecret)
	getResp := performProfileRequest(router, http.MethodGet, "/user-profile?machine_id=user-a", nil, headers)
	if getResp.Code != http.StatusOK {
		t.Fatalf("expected authorized GET success, got %d body=%s", getResp.Code, getResp.Body.String())
	}

	var getPayload struct {
		Profile map[string]any `json:"profile"`
	}
	if err := json.Unmarshal(getResp.Body.Bytes(), &getPayload); err != nil {
		t.Fatalf("decode get response: %v", err)
	}
	if got := int(getPayload.Profile["level"].(float64)); got != 0 {
		t.Fatalf("expected default level 0, got %d", got)
	}

	mismatchResp := performProfileRequest(
		router,
		http.MethodGet,
		"/user-profile?machine_id=user-b",
		nil,
		buildSignedTestHeaders("/user-profile", http.MethodGet, "user-a", clientAuthSecret),
	)
	if mismatchResp.Code != http.StatusForbidden {
		t.Fatalf("expected mismatched machine GET to be forbidden, got %d", mismatchResp.Code)
	}

	if err := db.Where("machine_id = ?", "user-a").Updates(&UserProfile{Level: 1, Verified: true}).Error; err != nil {
		t.Fatalf("seed level 1 verified: %v", err)
	}

	postHeaders := buildSignedTestHeaders("/user-profile", http.MethodPost, "user-a", clientAuthSecret)
	postResp := performProfileRequest(router, http.MethodPost, "/user-profile", map[string]any{
		"machine_id": "user-a",
		"nickname":   "Alpha",
	}, postHeaders)
	if postResp.Code != http.StatusOK {
		t.Fatalf("expected authorized POST success, got %d body=%s", postResp.Code, postResp.Body.String())
	}

	// POST 现在创建昵称请求而非直接写入
	var postPayload struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(postResp.Body.Bytes(), &postPayload); err != nil {
		t.Fatalf("decode post response: %v", err)
	}
	if postPayload.Status != "pending" {
		t.Fatalf("expected status pending, got %q", postPayload.Status)
	}

	// 确认 NicknameRequest 被创建
	var nickReq NicknameRequest
	if err := db.Where("machine_id = ? AND status = 'pending'", "user-a").First(&nickReq).Error; err != nil {
		t.Fatalf("expected nickname request to be created: %v", err)
	}
	if nickReq.Nickname != "Alpha" {
		t.Fatalf("expected requested nickname Alpha, got %q", nickReq.Nickname)
	}

	getRespAfterSubmit := performProfileRequest(router, http.MethodGet, "/user-profile?machine_id=user-a", nil, headers)
	if getRespAfterSubmit.Code != http.StatusOK {
		t.Fatalf("expected GET after submit success, got %d body=%s", getRespAfterSubmit.Code, getRespAfterSubmit.Body.String())
	}
	var getAfterPayload struct {
		Profile map[string]any `json:"profile"`
	}
	if err := json.Unmarshal(getRespAfterSubmit.Body.Bytes(), &getAfterPayload); err != nil {
		t.Fatalf("decode get-after-submit response: %v", err)
	}
	if pending := getAfterPayload.Profile["pending_nickname"]; pending != "Alpha" {
		t.Fatalf("expected pending nickname Alpha, got %#v", pending)
	}
	if hasPending := getAfterPayload.Profile["has_pending_nickname"]; hasPending != true {
		t.Fatalf("expected has_pending_nickname true, got %#v", hasPending)
	}
}

func TestUserProfileAdminRecalculatesLevelWhenLevelAndExpChangeTogether(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	if err := db.Create(&UserProfile{
		MachineID: "user-a",
		Level:     1,
		Exp:       0,
		Badges:    "[]",
	}).Error; err != nil {
		t.Fatalf("seed profile: %v", err)
	}

	router := gin.New()
	admin := router.Group("/admin")
	initUserProfileAdminRoutes(admin)

	resp := performProfileRequest(router, http.MethodPut, "/admin/user-profiles", map[string]any{
		"machine_id": "user-a",
		"level":      2,
		"exp":        10000,
	}, nil)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected admin PUT success, got %d body=%s", resp.Code, resp.Body.String())
	}

	var profile UserProfile
	if err := db.Where("machine_id = ?", "user-a").First(&profile).Error; err != nil {
		t.Fatalf("reload profile: %v", err)
	}
	if profile.Level != 6 {
		t.Fatalf("expected recalculated level 6, got %d", profile.Level)
	}
	if profile.Exp != 10000 {
		t.Fatalf("expected exp 10000, got %d", profile.Exp)
	}
}

func TestUserProfileAdminVerifyPromotesLevelAndDirectNicknameRejectsPending(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	if err := db.Create(&UserProfile{
		MachineID: "user-a",
		Level:     0,
		Exp:       0,
		Badges:    "[]",
		Verified:  false,
	}).Error; err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	if err := db.Create(&NicknameRequest{
		MachineID: "user-a",
		Nickname:  "PendingNick",
		Status:    "pending",
	}).Error; err != nil {
		t.Fatalf("seed pending nickname: %v", err)
	}

	router := gin.New()
	admin := router.Group("/admin")
	initUserProfileAdminRoutes(admin)

	resp := performProfileRequest(router, http.MethodPut, "/admin/user-profiles", map[string]any{
		"machine_id": "user-a",
		"verified":   true,
		"nickname":   "DirectNick",
	}, nil)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected admin PUT success, got %d body=%s", resp.Code, resp.Body.String())
	}

	var profile UserProfile
	if err := db.Where("machine_id = ?", "user-a").First(&profile).Error; err != nil {
		t.Fatalf("reload profile: %v", err)
	}
	if !profile.Verified {
		t.Fatalf("expected verified true")
	}
	if profile.Level != 1 {
		t.Fatalf("expected level promoted to 1, got %d", profile.Level)
	}
	if profile.Nickname != "DirectNick" {
		t.Fatalf("expected nickname DirectNick, got %q", profile.Nickname)
	}

	var pendingCount int64
	if err := db.Model(&NicknameRequest{}).Where("machine_id = ? AND status = 'pending'", "user-a").Count(&pendingCount).Error; err != nil {
		t.Fatalf("count pending requests: %v", err)
	}
	if pendingCount != 0 {
		t.Fatalf("expected pending requests cleared, got %d", pendingCount)
	}

	var rejected NicknameRequest
	if err := db.Where("machine_id = ? AND nickname = ?", "user-a", "PendingNick").First(&rejected).Error; err != nil {
		t.Fatalf("reload original request: %v", err)
	}
	if rejected.Status != "rejected" {
		t.Fatalf("expected original request rejected, got %q", rejected.Status)
	}
}

func TestConcurrentProfileInitializationCreatesSingleRow(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	previousSecret := clientAuthSecret
	clientAuthSecret = "unit-test-secret"
	defer func() {
		clientAuthSecret = previousSecret
	}()

	router := gin.New()
	router.Use(func(c *gin.Context) {
		if c.Request.URL.Path == "/user-profile" {
			if !requireClientRequest(c) {
				return
			}
		}
		c.Next()
	})
	initUserProfileClientRoutes(router)

	const requestCount = 12
	var wg sync.WaitGroup
	codes := make(chan int, requestCount)
	for i := 0; i < requestCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			headers := buildSignedTestHeaders("/user-profile", http.MethodGet, "user-concurrent", clientAuthSecret)
			resp := performProfileRequest(router, http.MethodGet, "/user-profile?machine_id=user-concurrent", nil, headers)
			codes <- resp.Code
		}()
	}
	wg.Wait()
	close(codes)

	for code := range codes {
		if code != http.StatusOK {
			t.Fatalf("expected concurrent profile init to succeed, got status %d", code)
		}
	}

	var count int64
	if err := db.Model(&UserProfile{}).Where("machine_id = ?", "user-concurrent").Count(&count).Error; err != nil {
		t.Fatalf("count profiles: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one profile row, got %d", count)
	}
}

func TestConcurrentNicknameApprovalIsAtomic(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	if err := db.Create(&NicknameRequest{
		MachineID: "user-a",
		Nickname:  "ApprovedNick",
		Status:    "pending",
	}).Error; err != nil {
		t.Fatalf("seed nickname request: %v", err)
	}

	var req NicknameRequest
	if err := db.Where("machine_id = ? AND status = 'pending'", "user-a").First(&req).Error; err != nil {
		t.Fatalf("reload request: %v", err)
	}

	router := gin.New()
	admin := router.Group("/admin")
	initUserProfileAdminRoutes(admin)

	const workers = 8
	var wg sync.WaitGroup
	codes := make(chan int, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp := performProfileRequest(router, http.MethodPost, "/admin/nickname-requests/"+strconv.Itoa(int(req.ID))+"/approve", nil, nil)
			codes <- resp.Code
		}()
	}
	wg.Wait()
	close(codes)

	successCount := 0
	conflictCount := 0
	for code := range codes {
		switch code {
		case http.StatusOK:
			successCount++
		case http.StatusConflict:
			conflictCount++
		default:
			t.Fatalf("unexpected approval status: %d", code)
		}
	}
	if successCount != 1 {
		t.Fatalf("expected exactly one successful approval, got %d", successCount)
	}
	if conflictCount != workers-1 {
		t.Fatalf("expected remaining approvals to conflict, got %d conflicts", conflictCount)
	}

	var profile UserProfile
	if err := db.Where("machine_id = ?", "user-a").First(&profile).Error; err != nil {
		t.Fatalf("reload approved profile: %v", err)
	}
	if profile.Nickname != "ApprovedNick" {
		t.Fatalf("expected approved nickname persisted, got %q", profile.Nickname)
	}

	if err := db.First(&req, req.ID).Error; err != nil {
		t.Fatalf("reload request after approval: %v", err)
	}
	if req.Status != "approved" {
		t.Fatalf("expected request approved, got %q", req.Status)
	}
}

func TestConcurrentNicknameSubmissionKeepsSinglePending(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	previousSecret := clientAuthSecret
	clientAuthSecret = "unit-test-secret"
	defer func() {
		clientAuthSecret = previousSecret
	}()

	if err := db.Create(&UserProfile{
		MachineID: "user-a",
		Level:     1,
		Exp:       0,
		Badges:    "[]",
		Verified:  true,
	}).Error; err != nil {
		t.Fatalf("seed profile: %v", err)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		if c.Request.URL.Path == "/user-profile" {
			if !requireClientRequest(c) {
				return
			}
		}
		c.Next()
	})
	initUserProfileClientRoutes(router)

	nicknames := []string{"Alpha", "Beta_1", "Gamma-2", "Delta3", "Echo4"}
	var wg sync.WaitGroup
	codes := make(chan int, len(nicknames))
	for _, nickname := range nicknames {
		nick := nickname
		wg.Add(1)
		go func() {
			defer wg.Done()
			headers := buildSignedTestHeaders("/user-profile", http.MethodPost, "user-a", clientAuthSecret)
			resp := performProfileRequest(router, http.MethodPost, "/user-profile", map[string]any{
				"machine_id": "user-a",
				"nickname":   nick,
			}, headers)
			codes <- resp.Code
		}()
	}
	wg.Wait()
	close(codes)

	for code := range codes {
		if code != http.StatusOK {
			t.Fatalf("expected concurrent submit success, got status %d", code)
		}
	}

	var pending []NicknameRequest
	if err := db.Where("machine_id = ? AND status = 'pending'", "user-a").Find(&pending).Error; err != nil {
		t.Fatalf("load pending requests: %v", err)
	}
	if len(pending) != 1 {
		t.Fatalf("expected exactly one pending nickname request, got %d", len(pending))
	}

	validNickname := false
	for _, nickname := range nicknames {
		if pending[0].Nickname == nickname {
			validNickname = true
			break
		}
	}
	if !validNickname {
		t.Fatalf("unexpected pending nickname %q", pending[0].Nickname)
	}
}

func TestNicknameRequestApproveRejectRejectInvalidID(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	router := gin.New()
	admin := router.Group("/admin")
	initUserProfileAdminRoutes(admin)

	approveResp := performProfileRequest(router, http.MethodPost, "/admin/nickname-requests/not-a-number/approve", nil, nil)
	if approveResp.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid approve id status 400, got %d body=%s", approveResp.Code, approveResp.Body.String())
	}

	rejectResp := performProfileRequest(router, http.MethodPost, "/admin/nickname-requests/0/reject", nil, nil)
	if rejectResp.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid reject id status 400, got %d body=%s", rejectResp.Code, rejectResp.Body.String())
	}
}

func TestNicknameRequestListRejectsInvalidStatus(t *testing.T) {
	setupUserProfileTestDB(t)
	gin.SetMode(gin.TestMode)

	router := gin.New()
	admin := router.Group("/admin")
	initUserProfileAdminRoutes(admin)

	resp := performProfileRequest(router, http.MethodGet, "/admin/nickname-requests?status=unknown", nil, nil)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid status query to return 400, got %d body=%s", resp.Code, resp.Body.String())
	}
}

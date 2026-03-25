package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func performSecurityJSONRequest(r http.Handler, method, path string, payload any, headers map[string]string) *httptest.ResponseRecorder {
	var body []byte
	if payload != nil {
		body, _ = json.Marshal(payload)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func bootstrapTestClientToken(t *testing.T, router http.Handler, machineID, secret string) string {
	t.Helper()

	resp := performSecurityJSONRequest(router, http.MethodPost, "/telemetry", map[string]any{
		"machine_id": machineID,
		"version":    "1.0.0",
	}, buildSignedTestHeadersWithoutDeviceToken("/telemetry", http.MethodPost, machineID, secret))
	if resp.Code != http.StatusOK {
		t.Fatalf("bootstrap telemetry failed: %d body=%s", resp.Code, resp.Body.String())
	}

	var payload struct {
		ClientDeviceToken string `json:"client_device_token"`
	}
	if err := json.Unmarshal(resp.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode bootstrap response: %v", err)
	}
	if strings.TrimSpace(payload.ClientDeviceToken) == "" {
		t.Fatalf("expected client_device_token in bootstrap response")
	}
	testClientDeviceTokens.Store(machineID, payload.ClientDeviceToken)
	return payload.ClientDeviceToken
}

func TestTelemetryBootstrapIssuesDeviceTokenAndProtectedRoutesRequireIt(t *testing.T) {
	setupClientRouteProtectionDB(t)
	gin.SetMode(gin.TestMode)

	prevAdminUser := adminUser
	prevAdminPass := adminPass
	prevSecret := clientAuthSecret
	prevSysConfig := sysConfig
	adminUser = "admin-test"
	adminPass = "pass-test"
	clientAuthSecret = "bootstrap-secret"
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

	deviceToken := bootstrapTestClientToken(t, router, "machine-secure", clientAuthSecret)

	noTokenResp := performProfileRequest(
		router,
		http.MethodGet,
		"/user-profile?machine_id=machine-secure",
		nil,
		buildSignedTestHeadersWithoutDeviceToken("/user-profile", http.MethodGet, "machine-secure", clientAuthSecret),
	)
	if noTokenResp.Code != http.StatusForbidden {
		t.Fatalf("expected missing device token to be forbidden, got %d body=%s", noTokenResp.Code, noTokenResp.Body.String())
	}

	validHeaders := buildSignedTestHeadersWithoutDeviceToken("/user-profile", http.MethodGet, "machine-secure", clientAuthSecret)
	validHeaders[clientDeviceTokenHeader] = deviceToken
	okResp := performProfileRequest(router, http.MethodGet, "/user-profile?machine_id=machine-secure", nil, validHeaders)
	if okResp.Code != http.StatusOK {
		t.Fatalf("expected valid device token to pass, got %d body=%s", okResp.Code, okResp.Body.String())
	}
}

func TestAdminDrilldownRejectsUnknownDimension(t *testing.T) {
	setupClientRouteProtectionDB(t)
	gin.SetMode(gin.TestMode)

	prevAdminUser := adminUser
	prevAdminPass := adminPass
	prevSecret := clientAuthSecret
	adminUser = "admin-test"
	adminPass = "pass-test"
	clientAuthSecret = "drilldown-secret"
	defer func() {
		adminUser = prevAdminUser
		adminPass = prevAdminPass
		clientAuthSecret = prevSecret
	}()

	router := gin.New()
	initRouter(router)

	req := httptest.NewRequest(http.MethodGet, "/admin/drilldown?dimension=os%20OR%201=1&value=Windows", nil)
	req.SetBasicAuth(adminUser, adminPass)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid dimension to be rejected, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestAIConfigRejectsDashboardKeyWithoutEncryptionKey(t *testing.T) {
	setupClientRouteProtectionDB(t)
	gin.SetMode(gin.TestMode)

	prevAdminUser := adminUser
	prevAdminPass := adminPass
	prevSecret := clientAuthSecret
	prevAIConfig := aiConfig
	prevAIEnvKey := aiEnvKey
	prevEncryptionKey, hadEncryptionKey := os.LookupEnv(aiConfigEncryptionEnv)
	adminUser = "admin-test"
	adminPass = "pass-test"
	clientAuthSecret = "ai-config-secret"
	aiConfig = defaultAIConfig()
	aiEnvKey = ""
	_ = os.Unsetenv(aiConfigEncryptionEnv)
	defer func() {
		adminUser = prevAdminUser
		adminPass = prevAdminPass
		clientAuthSecret = prevSecret
		aiConfig = prevAIConfig
		aiEnvKey = prevAIEnvKey
		if hadEncryptionKey {
			_ = os.Setenv(aiConfigEncryptionEnv, prevEncryptionKey)
		} else {
			_ = os.Unsetenv(aiConfigEncryptionEnv)
		}
	}()

	router := gin.New()
	initRouter(router)

	reqBody := AIProxyConfig{
		Enabled:      true,
		Provider:     "openai",
		ApiUrl:       "https://api.example.com/v1/chat/completions",
		ApiKey:       "plain-text-key",
		Model:        "demo-model",
		SystemPrompt: "hi",
		MaxTokens:    256,
		Temperature:  0.2,
		DailyLimit:   10,
		MaxHistory:   10,
	}
	resp := performSecurityJSONRequest(router, http.MethodPost, "/admin/ai/config", reqBody, map[string]string{
		"Authorization": "Basic " + basicAuthHeader(adminUser, adminPass),
	})
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected plaintext dashboard key save to be rejected, got %d body=%s", resp.Code, resp.Body.String())
	}
}

func TestWebSocketRejectsDisallowedOriginAndAcceptsSignedAuth(t *testing.T) {
	setupClientRouteProtectionDB(t)
	gin.SetMode(gin.TestMode)

	prevAdminUser := adminUser
	prevAdminPass := adminPass
	prevSecret := clientAuthSecret
	prevSysConfig := sysConfig
	prevHub := wsHub
	adminUser = "admin-test"
	adminPass = "pass-test"
	clientAuthSecret = "ws-secret"
	sysConfig = SystemConfig{
		BadgeSystemEnabled:    true,
		NicknameChangeEnabled: true,
		AvatarUploadEnabled:   true,
		NoticeCommentEnabled:  true,
		NoticeReactionEnabled: true,
		RedeemCodeEnabled:     true,
		FeedbackEnabled:       true,
	}
	wsHub = NewWebSocketHub()
	go wsHub.Run()
	defer func() {
		adminUser = prevAdminUser
		adminPass = prevAdminPass
		clientAuthSecret = prevSecret
		sysConfig = prevSysConfig
		wsHub = prevHub
	}()

	router := gin.New()
	initRouter(router)
	server := httptest.NewServer(router)
	defer server.Close()

	deviceToken := bootstrapTestClientToken(t, router, "ws-machine", clientAuthSecret)

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/ws"

	badHeader := http.Header{}
	badHeader.Set("Origin", "https://evil.example")
	if _, resp, err := websocket.DefaultDialer.Dial(wsURL, badHeader); err == nil {
		t.Fatalf("expected disallowed origin dial to fail")
	} else if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected forbidden websocket handshake, got resp=%v err=%v", resp, err)
	}

	goodHeader := http.Header{}
	goodHeader.Set("Origin", "http://localhost")
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, goodHeader)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()

	authHeaders := buildSignedTestHeadersWithoutDeviceToken("/ws", http.MethodGet, "ws-machine", clientAuthSecret)
	if err := conn.WriteJSON(map[string]any{
		"type":         "auth",
		"machine_id":   "ws-machine",
		"version":      "1.0.0",
		"timestamp":    authHeaders["X-AimerWT-Timestamp"],
		"signature":    authHeaders["X-AimerWT-Signature"],
		"device_token": deviceToken,
	}); err != nil {
		t.Fatalf("write websocket auth: %v", err)
	}

	var result map[string]any
	if err := conn.ReadJSON(&result); err != nil {
		t.Fatalf("read websocket auth result: %v", err)
	}
	if result["status"] != "success" {
		t.Fatalf("expected websocket auth success, got %#v", result)
	}
}

func basicAuthHeader(user, pass string) string {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetBasicAuth(user, pass)
	return strings.TrimPrefix(req.Header.Get("Authorization"), "Basic ")
}

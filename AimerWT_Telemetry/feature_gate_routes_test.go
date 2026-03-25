package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func performJSONRouteRequest(r http.Handler, method, path string, payload any) *httptest.ResponseRecorder {
	var body []byte
	if payload != nil {
		body, _ = json.Marshal(payload)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	return rr
}

func TestRedeemRouteReturnsForbiddenWhenFeatureDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)

	previous := sysConfig
	sysConfig = SystemConfig{RedeemCodeEnabled: false}
	defer func() {
		sysConfig = previous
	}()

	router := gin.New()
	router.POST("/redeem", handleRedeem)

	resp := performJSONRouteRequest(router, http.MethodPost, "/redeem", map[string]any{
		"code":       "ABCD-EFGH-JKLM",
		"machine_id": "machine-test",
	})
	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusForbidden, resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "兑换码功能已关闭") {
		t.Fatalf("expected disabled message, got %s", resp.Body.String())
	}
}

func TestFeedbackRouteReturnsForbiddenWhenFeatureDisabled(t *testing.T) {
	gin.SetMode(gin.TestMode)

	previous := sysConfig
	sysConfig = SystemConfig{FeedbackEnabled: false}
	defer func() {
		sysConfig = previous
	}()

	router := gin.New()
	router.POST("/feedback", handleFeedback)

	resp := performJSONRouteRequest(router, http.MethodPost, "/feedback", map[string]any{
		"machine_id": "machine-test",
		"content":    "test feedback",
	})
	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected status %d, got %d body=%s", http.StatusForbidden, resp.Code, resp.Body.String())
	}
	if !strings.Contains(resp.Body.String(), "问题反馈功能已关闭") {
		t.Fatalf("expected disabled message, got %s", resp.Body.String())
	}
}

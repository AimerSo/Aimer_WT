package main

import (
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

var allowedOrigins = loadAllowedOrigins()

func loadAllowedOrigins() map[string]struct{} {
	raw := strings.TrimSpace(os.Getenv("TELEMETRY_ALLOWED_ORIGINS"))
	values := []string{
		"null",
		"http://localhost",
		"https://localhost",
		"http://127.0.0.1",
		"https://127.0.0.1",
		"http://pywebview.flowrl.com",
		"https://pywebview.flowrl.com",
	}
	if raw != "" {
		values = strings.Split(raw, ",")
	}

	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized := normalizeOrigin(value)
		if normalized == "" {
			continue
		}
		result[normalized] = struct{}{}
	}
	return result
}

func normalizeOrigin(origin string) string {
	return strings.TrimRight(strings.TrimSpace(origin), "/")
}

func isSameOriginRequest(req *http.Request, origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Host, req.Host)
}

func isAllowedOrigin(req *http.Request, origin string) bool {
	normalized := normalizeOrigin(origin)
	if normalized == "" {
		return true
	}
	if isSameOriginRequest(req, normalized) {
		return true
	}
	_, ok := allowedOrigins[normalized]
	if ok {
		return true
	}
	// 宽松匹配：pywebview 使用 http://localhost:随机端口 加载页面，
	// 但白名单只记录了无端口的 http://localhost，因此去掉端口后再比对。
	parsed, err := url.Parse(normalized)
	if err == nil && parsed.Host != "" && parsed.Hostname() != "" {
		withoutPort := parsed.Scheme + "://" + parsed.Hostname()
		_, ok = allowedOrigins[withoutPort]
		if ok {
			return true
		}
	}
	return false
}

func applyCORSHeaders(c *gin.Context) bool {
	origin := normalizeOrigin(c.GetHeader("Origin"))
	if origin != "" && isAllowedOrigin(c.Request, origin) {
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Vary", "Origin")
	}
	c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-AimerWT-Client, X-AimerWT-Timestamp, X-AimerWT-Machine, X-AimerWT-Signature, X-AimerWT-Device-Token")

	if c.Request.Method == "OPTIONS" {
		if origin != "" && !isAllowedOrigin(c.Request, origin) {
			c.AbortWithStatus(http.StatusForbidden)
			return false
		}
		c.AbortWithStatus(http.StatusNoContent)
		return false
	}

	return true
}

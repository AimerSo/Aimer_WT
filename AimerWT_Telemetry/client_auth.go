package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var clientAuthSecret = strings.TrimSpace(os.Getenv("TELEMETRY_CLIENT_SECRET"))

const clientAuthClockSkew = 5 * time.Minute

func isClientAuthEnabled() bool {
	return clientAuthSecret != ""
}

func hasLegacyClientIdentity(c *gin.Context) bool {
	ua := c.GetHeader("User-Agent")
	clientHeader := c.GetHeader("X-AimerWT-Client")
	return strings.HasPrefix(ua, "AimerWT-Client") || clientHeader != ""
}

func verifyClientSignature(c *gin.Context) bool {
	if !isClientAuthEnabled() {
		return hasLegacyClientIdentity(c)
	}

	timestamp := strings.TrimSpace(c.GetHeader("X-AimerWT-Timestamp"))
	signature := strings.TrimSpace(c.GetHeader("X-AimerWT-Signature"))
	machineID := strings.TrimSpace(c.GetHeader("X-AimerWT-Machine"))
	if timestamp == "" || signature == "" {
		return false
	}

	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}

	now := time.Now()
	requestTime := time.Unix(ts, 0)
	if requestTime.Before(now.Add(-clientAuthClockSkew)) || requestTime.After(now.Add(clientAuthClockSkew)) {
		return false
	}

	canonical := strings.Join([]string{
		strings.ToUpper(c.Request.Method),
		c.Request.URL.Path,
		machineID,
		timestamp,
	}, "\n")

	expectedMAC := hmac.New(sha256.New, []byte(clientAuthSecret))
	expectedMAC.Write([]byte(canonical))
	expected := expectedMAC.Sum(nil)

	provided, err := hex.DecodeString(signature)
	if err != nil {
		return false
	}
	return hmac.Equal(provided, expected)
}

func requireClientRequest(c *gin.Context) bool {
	if verifyClientSignature(c) {
		return true
	}
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access Denied"})
	return false
}

func ensureClientMachineBinding(c *gin.Context, machineID string) bool {
	if !isClientAuthEnabled() {
		return true
	}

	expected := strings.TrimSpace(c.GetHeader("X-AimerWT-Machine"))
	actual := strings.TrimSpace(machineID)
	if expected == "" || actual == "" || expected != actual {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Machine binding mismatch"})
		return false
	}
	return true
}

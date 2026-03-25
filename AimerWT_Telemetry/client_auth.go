package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

var clientAuthSecret = strings.TrimSpace(os.Getenv("TELEMETRY_CLIENT_SECRET"))

const (
	clientAuthClockSkew   = 5 * time.Minute
	clientDeviceTokenSize = 32
)

const clientDeviceTokenHeader = "X-AimerWT-Device-Token"

func isClientAuthEnabled() bool {
	return clientAuthSecret != ""
}

func verifyClientSignatureValues(method, path, machineID, timestamp, signature string) bool {
	if !isClientAuthEnabled() {
		return false
	}

	timestamp = strings.TrimSpace(timestamp)
	signature = strings.TrimSpace(signature)
	machineID = strings.TrimSpace(machineID)
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
		strings.ToUpper(strings.TrimSpace(method)),
		strings.TrimSpace(path),
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

func verifyClientSignature(c *gin.Context) bool {
	return verifyClientSignatureValues(
		c.Request.Method,
		c.Request.URL.Path,
		c.GetHeader("X-AimerWT-Machine"),
		c.GetHeader("X-AimerWT-Timestamp"),
		c.GetHeader("X-AimerWT-Signature"),
	)
}

func requireClientRequest(c *gin.Context) bool {
	if verifyClientSignature(c) {
		return true
	}
	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "访问被拒绝"})
	return false
}

func hashClientDeviceToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

func lookupClientDeviceToken(machineID string) (ClientDeviceToken, error) {
	var record ClientDeviceToken
	err := db.Where("machine_id = ?", strings.TrimSpace(machineID)).First(&record).Error
	return record, err
}

func generateClientDeviceToken() (string, error) {
	buf := make([]byte, clientDeviceTokenSize)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func issueClientDeviceToken(machineID string) (string, error) {
	normalizedMachineID := strings.TrimSpace(machineID)
	if normalizedMachineID == "" {
		return "", errors.New("machine_id required")
	}

	token, err := generateClientDeviceToken()
	if err != nil {
		return "", err
	}

	record := ClientDeviceToken{
		MachineID:  normalizedMachineID,
		TokenHash:  hashClientDeviceToken(token),
		LastIssued: time.Now(),
	}

	if err := db.Create(&record).Error; err != nil {
		return "", err
	}
	return token, nil
}

func hasClientDeviceToken(machineID string) bool {
	_, err := lookupClientDeviceToken(machineID)
	return err == nil
}

func verifyClientDeviceToken(machineID, token string) bool {
	if strings.TrimSpace(machineID) == "" || strings.TrimSpace(token) == "" {
		return false
	}

	record, err := lookupClientDeviceToken(machineID)
	if err != nil {
		return false
	}

	expected := record.TokenHash
	provided := hashClientDeviceToken(token)
	return hmac.Equal([]byte(provided), []byte(expected))
}

func ensureClientDeviceToken(c *gin.Context, machineID string, allowBootstrap bool) bool {
	normalizedMachineID := strings.TrimSpace(machineID)
	if normalizedMachineID == "" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "设备绑定不匹配"})
		return false
	}

	token := strings.TrimSpace(c.GetHeader(clientDeviceTokenHeader))
	if token != "" {
		if verifyClientDeviceToken(normalizedMachineID, token) {
			return true
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "设备令牌无效"})
		return false
	}

	if allowBootstrap && !hasClientDeviceToken(normalizedMachineID) {
		return true
	}

	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "缺少设备令牌"})
	return false
}

func ensureClientMachineBinding(c *gin.Context, machineID string) bool {
	expected := strings.TrimSpace(c.GetHeader("X-AimerWT-Machine"))
	actual := strings.TrimSpace(machineID)
	if expected == "" || actual == "" || expected != actual {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "设备绑定不匹配"})
		return false
	}

	allowBootstrap := c.Request.URL.Path == "/telemetry"
	return ensureClientDeviceToken(c, actual, allowBootstrap)
}

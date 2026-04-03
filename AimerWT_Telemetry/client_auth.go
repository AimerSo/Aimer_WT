package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm/clause"
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

	// Upsert：machine_id 已有记录时更新 token_hash 和 last_issued，
	// 避免唯一索引冲突导致签发失败。
	if err := db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "machine_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"token_hash", "last_issued"}),
	}).Create(&record).Error; err != nil {
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
		// token 验证失败：对于 /telemetry（allowBootstrap=true），自动重签
		// 而非直接 403，以防止客户端进入死循环。
		if allowBootstrap {
			log.Printf("[Auth] 设备令牌验证失败，将自动重签: %s", normalizedMachineID)
			c.Set("_deviceTokenRenew", true)
			return true
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "设备令牌无效", "should_reauth": true})
		return false
	}

	// 无 token：首次引导（allowBootstrap 且服务端无记录）或自动重签（allowBootstrap 且服务端有旧记录）
	if allowBootstrap {
		if hasClientDeviceToken(normalizedMachineID) {
			// 客户端丢失了 token 但服务端有记录 → 标记需要重签
			log.Printf("[Auth] 客户端未携带设备令牌但服务端存在记录，将自动重签: %s", normalizedMachineID)
			c.Set("_deviceTokenRenew", true)
		}
		return true
	}

	c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "缺少设备令牌", "should_reauth": true})
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

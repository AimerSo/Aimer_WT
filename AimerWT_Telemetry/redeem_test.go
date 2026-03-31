package main

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupRedeemTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	store, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "redeem_test.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := store.AutoMigrate(&AIUserLimit{}); err != nil {
		t.Fatalf("migrate redeem test db: %v", err)
	}
	return store
}

func TestExecuteRedeemPayloadDailyLimitBonusUsesGlobalDefault(t *testing.T) {
	store := setupRedeemTestDB(t)
	prevConfig := aiConfig
	aiConfig = defaultAIConfig()
	aiConfig.DailyLimit = 15
	defer func() {
		aiConfig = prevConfig
	}()

	redeemCode := &RedeemCode{Payload: `{"daily_limit_bonus":5}`}
	if _, err := executeRedeemPayload(store, "user-default", redeemCode); err != nil {
		t.Fatalf("execute redeem payload: %v", err)
	}

	var limit AIUserLimit
	if err := store.Where("machine_id = ?", "user-default").First(&limit).Error; err != nil {
		t.Fatalf("load AIUserLimit: %v", err)
	}
	if limit.DailyLimit != 20 {
		t.Fatalf("daily_limit = %d, want 20", limit.DailyLimit)
	}
}

func TestExecuteRedeemPayloadDailyLimitBonusBuildsOnCustomLimit(t *testing.T) {
	store := setupRedeemTestDB(t)
	prevConfig := aiConfig
	aiConfig = defaultAIConfig()
	aiConfig.DailyLimit = 15
	defer func() {
		aiConfig = prevConfig
	}()

	existing := AIUserLimit{MachineID: "user-custom", DailyLimit: 30}
	if err := store.Create(&existing).Error; err != nil {
		t.Fatalf("seed AIUserLimit: %v", err)
	}

	redeemCode := &RedeemCode{Payload: `{"daily_limit_bonus":5}`}
	if _, err := executeRedeemPayload(store, "user-custom", redeemCode); err != nil {
		t.Fatalf("execute redeem payload: %v", err)
	}

	var limit AIUserLimit
	if err := store.Where("machine_id = ?", "user-custom").First(&limit).Error; err != nil {
		t.Fatalf("load AIUserLimit: %v", err)
	}
	if limit.DailyLimit != 35 {
		t.Fatalf("daily_limit = %d, want 35", limit.DailyLimit)
	}
}

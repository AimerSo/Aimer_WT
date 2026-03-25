package main

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func setupUserFeatureConfigTestDB(t *testing.T) {
	t.Helper()

	var err error
	db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "user_feature_config.db")), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&ContentConfig{}); err != nil {
		t.Fatalf("auto migrate config: %v", err)
	}
	sysConfig = SystemConfig{}
}

func TestRestoreSysConfigDefaultsUserFeaturesToEnabled(t *testing.T) {
	setupUserFeatureConfigTestDB(t)

	SaveConfig("sys_config", `{"notice_active":true}`)
	RestoreSysConfig()

	if !sysConfig.BadgeSystemEnabled {
		t.Fatalf("BadgeSystemEnabled = false, want true")
	}
	if !sysConfig.NicknameChangeEnabled {
		t.Fatalf("NicknameChangeEnabled = false, want true")
	}
	if !sysConfig.AvatarUploadEnabled {
		t.Fatalf("AvatarUploadEnabled = false, want true")
	}
	if !sysConfig.NoticeCommentEnabled {
		t.Fatalf("NoticeCommentEnabled = false, want true")
	}
	if !sysConfig.NoticeReactionEnabled {
		t.Fatalf("NoticeReactionEnabled = false, want true")
	}
	if !sysConfig.RedeemCodeEnabled {
		t.Fatalf("RedeemCodeEnabled = false, want true")
	}
	if !sysConfig.FeedbackEnabled {
		t.Fatalf("FeedbackEnabled = false, want true")
	}
}

func TestRestoreSysConfigPreservesExplicitUserFeatureDisables(t *testing.T) {
	setupUserFeatureConfigTestDB(t)

	SaveConfig("sys_config", `{
		"badge_system_enabled": false,
		"notice_comment_enabled": false,
		"feedback_enabled": false
	}`)
	RestoreSysConfig()

	if sysConfig.BadgeSystemEnabled {
		t.Fatalf("BadgeSystemEnabled = true, want false")
	}
	if sysConfig.NoticeCommentEnabled {
		t.Fatalf("NoticeCommentEnabled = true, want false")
	}
	if sysConfig.FeedbackEnabled {
		t.Fatalf("FeedbackEnabled = true, want false")
	}
	if !sysConfig.NicknameChangeEnabled || !sysConfig.AvatarUploadEnabled || !sysConfig.NoticeReactionEnabled || !sysConfig.RedeemCodeEnabled {
		t.Fatalf("unspecified feature flags should default to true: %+v", sysConfig)
	}
}

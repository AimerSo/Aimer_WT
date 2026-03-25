package main

import "encoding/json"

const (
	userFeatureBadgeSystemKey    = "badge_system_enabled"
	userFeatureNicknameKey       = "nickname_change_enabled"
	userFeatureAvatarKey         = "avatar_upload_enabled"
	userFeatureNoticeCommentKey  = "notice_comment_enabled"
	userFeatureNoticeReactionKey = "notice_reaction_enabled"
	userFeatureRedeemCodeKey     = "redeem_code_enabled"
	userFeatureFeedbackKey       = "feedback_enabled"
)

func applyDefaultUserFeatureFlags(cfg *SystemConfig, raw map[string]json.RawMessage) {
	if cfg == nil {
		return
	}

	if raw == nil || raw[userFeatureBadgeSystemKey] == nil {
		cfg.BadgeSystemEnabled = true
	}
	if raw == nil || raw[userFeatureNicknameKey] == nil {
		cfg.NicknameChangeEnabled = true
	}
	if raw == nil || raw[userFeatureAvatarKey] == nil {
		cfg.AvatarUploadEnabled = true
	}
	if raw == nil || raw[userFeatureNoticeCommentKey] == nil {
		cfg.NoticeCommentEnabled = true
	}
	if raw == nil || raw[userFeatureNoticeReactionKey] == nil {
		cfg.NoticeReactionEnabled = true
	}
	if raw == nil || raw[userFeatureRedeemCodeKey] == nil {
		cfg.RedeemCodeEnabled = true
	}
	if raw == nil || raw[userFeatureFeedbackKey] == nil {
		cfg.FeedbackEnabled = true
	}
}

func userFeatureFlagsMap(cfg SystemConfig) map[string]bool {
	return map[string]bool{
		userFeatureBadgeSystemKey:    cfg.BadgeSystemEnabled,
		userFeatureNicknameKey:       cfg.NicknameChangeEnabled,
		userFeatureAvatarKey:         cfg.AvatarUploadEnabled,
		userFeatureNoticeCommentKey:  cfg.NoticeCommentEnabled,
		userFeatureNoticeReactionKey: cfg.NoticeReactionEnabled,
		userFeatureRedeemCodeKey:     cfg.RedeemCodeEnabled,
		userFeatureFeedbackKey:       cfg.FeedbackEnabled,
	}
}

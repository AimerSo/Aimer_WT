package main

import "testing"

func TestNormalizeKnowledgeAdsConfig_FillsMissingSlots(t *testing.T) {
	cfg := normalizeKnowledgeAdsConfig(KnowledgeAdsConfig{
		Items: []KnowledgeAdItem{
			{
				ID:       "custom_slot",
				Enabled:  true,
				Title:    " Test Title ",
				Action:   "popup",
				Subtitle: " Sub ",
			},
		},
	})

	if len(cfg.Items) != 4 {
		t.Fatalf("expected 4 items, got %d", len(cfg.Items))
	}
	if cfg.Items[0].ID != "custom_slot" {
		t.Fatalf("expected first item id to be preserved, got %q", cfg.Items[0].ID)
	}
	if cfg.Items[0].Title != "Test Title" {
		t.Fatalf("expected trimmed title, got %q", cfg.Items[0].Title)
	}
	if cfg.Items[0].Action != "popup" {
		t.Fatalf("expected popup action, got %q", cfg.Items[0].Action)
	}
	if cfg.Items[1].ID != "kb_ad_2" {
		t.Fatalf("expected missing slot to be auto-filled, got %q", cfg.Items[1].ID)
	}
	if cfg.Items[1].Action != "link" {
		t.Fatalf("expected default action link, got %q", cfg.Items[1].Action)
	}
}

func TestNormalizeKnowledgeAdsConfig_InvalidActionFallsBackToLink(t *testing.T) {
	cfg := normalizeKnowledgeAdsConfig(KnowledgeAdsConfig{
		Items: []KnowledgeAdItem{
			{
				ID:     "kb_ad_1",
				Action: "unknown",
			},
		},
	})

	if cfg.Items[0].Action != "link" {
		t.Fatalf("expected invalid action to fall back to link, got %q", cfg.Items[0].Action)
	}
}

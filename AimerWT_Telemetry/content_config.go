package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// 配置持久化层：将 KV 配置存入 SQLite，服务重启后自动恢复

var configMu sync.RWMutex

// SaveConfig 将单个配置项写入数据库
func SaveConfig(key, value string) {
	configMu.Lock()
	defer configMu.Unlock()

	db.Where("key = ?", key).Assign(ContentConfig{Value: value}).FirstOrCreate(&ContentConfig{Key: key})
}

// LoadConfig 从数据库读取单个配置项
func LoadConfig(key string) string {
	configMu.RLock()
	defer configMu.RUnlock()

	var cfg ContentConfig
	if err := db.Where("key = ?", key).First(&cfg).Error; err != nil {
		return ""
	}
	return cfg.Value
}

// LoadAllConfigs 从数据库读取所有配置项
func LoadAllConfigs() map[string]string {
	configMu.RLock()
	defer configMu.RUnlock()

	var items []ContentConfig
	db.Find(&items)
	result := make(map[string]string, len(items))
	for _, item := range items {
		result[item.Key] = item.Value
	}
	return result
}

// PersistSysConfig 将当前 sysConfig 持久化到数据库
func PersistSysConfig() {
	data, err := json.Marshal(sysConfig)
	if err != nil {
		log.Printf("[Config] sysConfig 序列化失败: %v", err)
		return
	}
	SaveConfig("sys_config", string(data))
}

// RestoreSysConfig 从数据库恢复 sysConfig（服务启动时调用）
func RestoreSysConfig() {
	raw := LoadConfig("sys_config")
	if raw == "" {
		log.Println("[Config] 无历史配置，使用默认值")
		applyDefaultUserFeatureFlags(&sysConfig, nil)
		return
	}
	var rawMap map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &rawMap); err != nil {
		rawMap = nil
	}
	if err := json.Unmarshal([]byte(raw), &sysConfig); err != nil {
		log.Printf("[Config] sysConfig 反序列化失败: %v", err)
		applyDefaultUserFeatureFlags(&sysConfig, nil)
		return
	}
	applyDefaultUserFeatureFlags(&sysConfig, rawMap)
	log.Println("[Config] 已从数据库恢复 sysConfig")
}

// SaveAdCarouselItems 将广告轮播数据持久化，并清理不再引用的旧图片
func SaveAdCarouselItems(items []AdCarouselItem) {
	// 获取旧配置中引用的图片路径
	oldItems := LoadAdCarouselItems()
	oldImages := make(map[string]bool)
	for _, item := range oldItems {
		if item.Image != "" {
			oldImages[item.Image] = true
		}
	}

	// 获取新配置中引用的图片路径
	newImages := make(map[string]bool)
	for _, item := range items {
		if item.Image != "" {
			newImages[item.Image] = true
		}
	}

	// 保存新配置
	data, err := json.Marshal(items)
	if err != nil {
		log.Printf("[Config] 广告轮播序列化失败: %v", err)
		return
	}
	SaveConfig("ad_carousel_items", string(data))

	// 删除不再引用的旧图片文件
	for img := range oldImages {
		if newImages[img] {
			continue
		}
		// 提取本地路径部分（/uploads/xxx.webp → uploads/xxx.webp）
		localPath := img
		if idx := strings.Index(localPath, "/uploads/"); idx >= 0 {
			localPath = localPath[idx+1:]
		} else if strings.HasPrefix(localPath, "/uploads/") {
			localPath = localPath[1:]
		}
		if !strings.HasPrefix(localPath, "uploads/") {
			continue
		}
		absPath := filepath.Join(".", localPath)
		if _, err := os.Stat(absPath); err == nil {
			if err := os.Remove(absPath); err == nil {
				log.Printf("[Config] 已清理孤儿广告图片: %s", localPath)
			}
		}
	}
}

// LoadAdCarouselItems 从数据库加载广告轮播数据
func LoadAdCarouselItems() []AdCarouselItem {
	raw := LoadConfig("ad_carousel_items")
	if raw == "" {
		return []AdCarouselItem{}
	}
	var items []AdCarouselItem
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		log.Printf("[Config] 广告轮播反序列化失败: %v", err)
		return []AdCarouselItem{}
	}
	return items
}

// LoadAdCarouselInterval 返回广告轮播自动播放间隔，未配置时使用默认值
func LoadAdCarouselInterval() int {
	raw := LoadConfig("ad_carousel_interval_ms")
	if raw == "" {
		return 4500
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 4500
	}
	return value
}

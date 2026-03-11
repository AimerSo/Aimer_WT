package main

import (
	"encoding/json"
	"log"
	"strconv"
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
		return
	}
	if err := json.Unmarshal([]byte(raw), &sysConfig); err != nil {
		log.Printf("[Config] sysConfig 反序列化失败: %v", err)
		return
	}
	log.Println("[Config] 已从数据库恢复 sysConfig")
}

// SaveAdCarouselItems 将广告轮播数据持久化
func SaveAdCarouselItems(items []AdCarouselItem) {
	data, err := json.Marshal(items)
	if err != nil {
		log.Printf("[Config] 广告轮播序列化失败: %v", err)
		return
	}
	SaveConfig("ad_carousel_items", string(data))
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

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// WebSocket 连接升级器
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// 允许所有来源（生产环境应限制域名）
		return true
	},
}

// ClientConnection 表示一个 WebSocket 客户端连接
type ClientConnection struct {
	Conn            *websocket.Conn
	MachineID       string
	Version         string
	LastPing        time.Time
	IsAuthenticated bool
}

// WebSocketHub 管理所有 WebSocket 连接
type WebSocketHub struct {
	clients    map[*ClientConnection]bool
	register   chan *ClientConnection
	unregister chan *ClientConnection
	broadcast  chan []byte
	mu         sync.RWMutex
}

// 全局 WebSocket Hub
var wsHub *WebSocketHub

// NewWebSocketHub 创建新的 Hub
func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		clients:    make(map[*ClientConnection]bool),
		register:   make(chan *ClientConnection),
		unregister: make(chan *ClientConnection),
		broadcast:  make(chan []byte, 256),
	}
}

// Run 启动 Hub 的事件循环
func (h *WebSocketHub) Run() {
	// 启动心跳检测协程
	go h.heartbeatChecker()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("[WebSocket] 客户端连接: %s, 当前连接数: %d", client.MachineID, h.ClientCount())

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.Conn.Close()
			}
			h.mu.Unlock()
			log.Printf("[WebSocket] 客户端断开: %s, 当前连接数: %d", client.MachineID, h.ClientCount())

		case message := <-h.broadcast:
			h.mu.RLock()
			clients := make([]*ClientConnection, 0, len(h.clients))
			for client := range h.clients {
				clients = append(clients, client)
			}
			h.mu.RUnlock()

			for _, client := range clients {
				// 只发送给已认证的客户端
				if !client.IsAuthenticated {
					continue
				}
				if !client.send(message) {
					// 发送失败，关闭连接
					go func(c *ClientConnection) {
						h.unregister <- c
					}(client)
				}
			}
		}
	}
}

// ClientCount 返回当前连接数
func (h *WebSocketHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// BroadcastToAll 广播消息给所有已认证客户端
func (h *WebSocketHub) BroadcastToAll(message []byte) {
	select {
	case h.broadcast <- message:
	default:
		log.Println("[WebSocket] 广播通道已满，消息丢弃")
	}
}

// BroadcastToVersion 按版本广播
func (h *WebSocketHub) BroadcastToVersion(version string, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for client := range h.clients {
		if client.IsAuthenticated && client.Version == version {
			client.Conn.WriteMessage(websocket.TextMessage, message)
		}
	}
}

// heartbeatChecker 定期检查连接健康状态
func (h *WebSocketHub) heartbeatChecker() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		h.mu.Lock()
		now := time.Now()
		for client := range h.clients {
			// 60秒未收到 ping 则断开
			if now.Sub(client.LastPing) > 60*time.Second {
				log.Printf("[WebSocket] 连接超时: %s", client.MachineID)
				client.Conn.Close()
				delete(h.clients, client)
			}
		}
		h.mu.Unlock()
	}
}

// send 发送消息到客户端（带超时保护）
func (c *ClientConnection) send(message []byte) bool {
	c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return c.Conn.WriteMessage(websocket.TextMessage, message) == nil
}

// HandleWebSocket WebSocket 连接处理函数
func HandleWebSocket(c *gin.Context) {
	// 升级 HTTP 连接到 WebSocket
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("[WebSocket] 升级失败: %v", err)
		return
	}

	client := &ClientConnection{
		Conn:     conn,
		LastPing: time.Now(),
	}

	// 注册连接
	wsHub.register <- client

	// 启动读写协程
	go client.writePump()
	client.readPump()
}

// readPump 读取客户端消息
func (c *ClientConnection) readPump() {
	defer func() {
		wsHub.unregister <- c
	}()

	c.Conn.SetReadLimit(512 * 1024) // 最大 512KB
	c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.Conn.SetPongHandler(func(string) error {
		c.LastPing = time.Now()
		c.Conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WebSocket] 读取错误: %v", err)
			}
			break
		}

		// 处理客户端消息
		c.handleMessage(message)
	}
}

// writePump 向客户端发送消息
func (c *ClientConnection) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for range ticker.C {
		c.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
			return
		}
	}
}

// handleMessage 处理客户端发来的消息
func (c *ClientConnection) handleMessage(message []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(message, &msg); err != nil {
		log.Printf("[WebSocket] 消息解析失败: %v", err)
		return
	}

	msgType, _ := msg["type"].(string)

	switch msgType {
	case "auth":
		// 认证消息
		c.handleAuth(msg)
	case "ping":
		// 心跳响应
		c.LastPing = time.Now()
	default:
		log.Printf("[WebSocket] 未知消息类型: %s", msgType)
	}
}

// handleAuth 处理认证
func (c *ClientConnection) handleAuth(msg map[string]interface{}) {
	machineID, _ := msg["machine_id"].(string)
	version, _ := msg["version"].(string)

	// 简单验证：machine_id 必须存在
	if machineID == "" {
		c.sendJSON(map[string]interface{}{
			"type":   "auth_result",
			"status": "failed",
			"error":  "machine_id required",
		})
		return
	}

	c.MachineID = machineID
	c.Version = version
	c.IsAuthenticated = true
	c.LastPing = time.Now()

	c.sendJSON(map[string]interface{}{
		"type":   "auth_result",
		"status": "success",
	})

	log.Printf("[WebSocket] 客户端认证成功: %s (版本: %s)", machineID, version)
}

// sendJSON 发送 JSON 消息
func (c *ClientConnection) sendJSON(data interface{}) bool {
	message, err := json.Marshal(data)
	if err != nil {
		return false
	}
	return c.send(message)
}

// PushMessage 推送消息结构
type PushMessage struct {
	Type   string      `json:"type"`
	Action string      `json:"action"`
	Data   interface{} `json:"data"`
	Time   int64       `json:"time"`
}

// BroadcastAlert 广播紧急通知
func BroadcastAlert(title, content, scope string) {
	msg := PushMessage{
		Type:   "alert",
		Action: "show",
		Data: map[string]string{
			"title":   title,
			"content": content,
			"scope":   scope,
		},
		Time: time.Now().Unix(),
	}

	data, _ := json.Marshal(msg)
	wsHub.BroadcastToAll(data)
}

// BroadcastNotice 广播公告
func BroadcastNotice(content, scope string) {
	msg := PushMessage{
		Type:   "notice",
		Action: "update",
		Data: map[string]string{
			"content": content,
			"scope":   scope,
		},
		Time: time.Now().Unix(),
	}

	data, _ := json.Marshal(msg)
	wsHub.BroadcastToAll(data)
}

// BroadcastUpdate 广播更新通知
func BroadcastUpdate(content, url, scope string) {
	msg := PushMessage{
		Type:   "update",
		Action: "notify",
		Data: map[string]string{
			"content": content,
			"url":     url,
			"scope":   scope,
		},
		Time: time.Now().Unix(),
	}

	data, _ := json.Marshal(msg)
	wsHub.BroadcastToAll(data)
}

// BroadcastMaintenance 广播维护模式
func BroadcastMaintenance(enabled bool, message string) {
	msg := PushMessage{
		Type:   "maintenance",
		Action: "status",
		Data: map[string]interface{}{
			"enabled": enabled,
			"message": message,
		},
		Time: time.Now().Unix(),
	}

	data, _ := json.Marshal(msg)
	wsHub.BroadcastToAll(data)
}

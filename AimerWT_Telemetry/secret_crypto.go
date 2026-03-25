package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"strings"
)

const aiConfigEncryptionEnv = "AI_CONFIG_ENCRYPTION_KEY"

func getSecretEncryptionKey() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv(aiConfigEncryptionEnv))
	if raw == "" {
		return nil, errors.New("missing encryption key")
	}
	sum := sha256.Sum256([]byte(raw))
	return sum[:], nil
}

func canEncryptStoredSecrets() bool {
	_, err := getSecretEncryptionKey()
	return err == nil
}

func encryptStoredSecret(plaintext string) (string, error) {
	key, err := getSecretEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	payload := append(nonce, ciphertext...)
	return base64.RawStdEncoding.EncodeToString(payload), nil
}

func decryptStoredSecret(ciphertext string) (string, error) {
	key, err := getSecretEncryptionKey()
	if err != nil {
		return "", err
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimSpace(ciphertext))
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}

	nonce := raw[:gcm.NonceSize()]
	encrypted := raw[gcm.NonceSize():]
	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

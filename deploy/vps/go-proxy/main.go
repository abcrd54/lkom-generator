package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ImageRequest struct {
	Model        string   `json:"model"`
	Prompt       string   `json:"prompt"`
	N            int      `json:"n"`
	Size         string   `json:"size"`
	Quality      string   `json:"quality"`
	Background   string   `json:"background"`
	ImageDetail  string   `json:"image_detail"`
	OutputFormat string   `json:"output_format"`
	Image        string   `json:"image,omitempty"`
	Images       []string `json:"images,omitempty"`
}

type ImageResponse struct {
	Success bool   `json:"success"`
	B64JSON string `json:"b64_json,omitempty"`
	Error   string `json:"error,omitempty"`
	Size    int    `json:"size,omitempty"`
}

var storageDir = "/data/images"

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "20129"
	}
	apiURL := os.Getenv("NINEROUTER_URL")
	if apiURL == "" {
		apiURL = "http://172.17.0.1:20128"
	}
	apiKey := os.Getenv("NINEROUTER_API_KEY")
	if apiKey == "" {
		apiKey = "sk-4ab3e463a07ad0cd-939969-c4fd7754"
	}

	os.MkdirAll(storageDir, 0755)

	http.HandleFunc("/generate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var req ImageRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		log.Printf("[GoProxy] Request: model=%s, prompt=%s, image=%d chars", req.Model, req.Prompt[:min(50, len(req.Prompt))], len(req.Image))

		result := generateImage(apiURL, apiKey, req)

		log.Printf("[GoProxy] Result: success=%v, size=%d, error=%s", result.Success, result.Size, result.Error)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	http.HandleFunc("/upload", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var body struct {
			Data      string `json:"data"`
			Extension string `json:"extension"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		ext := body.Extension
		if ext == "" {
			ext = "jpg"
		}

		filename := fmt.Sprintf("%d.%s", time.Now().UnixNano(), ext)
		filePath := filepath.Join(storageDir, filename)

		data, err := base64.StdEncoding.DecodeString(body.Data)
		if err != nil {
			http.Error(w, "Invalid base64", http.StatusBadRequest)
			return
		}

		if err := os.WriteFile(filePath, data, 0644); err != nil {
			http.Error(w, "Failed to save file", http.StatusInternalServerError)
			return
		}

		localURL := fmt.Sprintf("http://54.179.142.26:%s/files/%s", port, filename)
		log.Printf("[GoProxy] Uploaded %s (%d bytes) -> %s", filename, len(data), localURL)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"url": localURL})
	})

	http.HandleFunc("/files/", func(w http.ResponseWriter, r *http.Request) {
		filename := strings.TrimPrefix(r.URL.Path, "/files/")
		filePath := filepath.Join(storageDir, filename)

		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}

		http.ServeFile(w, r, filePath)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})

	log.Printf("[GoProxy] Starting on :%s (storage: %s)", port, storageDir)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func generateImage(apiURL, apiKey string, req ImageRequest) ImageResponse {
	maxRetries := 5
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			delay := 5 * time.Second
			log.Printf("[GoProxy] Retry %d/%d after %v", attempt, maxRetries, delay)
			time.Sleep(delay)
		}

		client := &http.Client{Timeout: 120 * time.Second}
		body, _ := json.Marshal(req)

		endpoint := fmt.Sprintf("%s/v1/images/generations", apiURL)
		log.Printf("[GoProxy] Attempt %d: POST %s, body=%d bytes", attempt, endpoint, len(body))

		httpReq, err := http.NewRequest("POST", endpoint, strings.NewReader(string(body)))
		if err != nil {
			log.Printf("[GoProxy] Request build error: %v", err)
			continue
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "text/event-stream")
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)

		start := time.Now()
		resp, err := client.Do(httpReq)
		elapsed := time.Since(start).Seconds()

		if err != nil {
			log.Printf("[GoProxy] Attempt %d error: %v (%.1fs)", attempt, err, elapsed)
			continue
		}

		ct := resp.Header.Get("Content-Type")
		log.Printf("[GoProxy] Attempt %d: status=%d, ct=%s, %.1fs", attempt, resp.StatusCode, ct, elapsed)

		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			log.Printf("[GoProxy] Error body: %s", string(bodyBytes[:min(200, len(bodyBytes))]))
			continue
		}

		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if ct == "" || ct == "application/octet-stream" || (len(ct) >= 5 && ct[:5] == "image") {
			log.Printf("[GoProxy] SUCCESS (binary): %d bytes in %.1fs", len(bodyBytes), elapsed)
			return ImageResponse{
				Success: true,
				B64JSON: base64Encode(bodyBytes),
				Size:    len(bodyBytes),
			}
		}

		var jsonResp struct {
			Data []struct {
				B64JSON string `json:"b64_json"`
				URL     string `json:"url"`
			} `json:"data"`
		}
		if json.Unmarshal(bodyBytes, &jsonResp) == nil && len(jsonResp.Data) > 0 {
			if jsonResp.Data[0].B64JSON != "" {
				log.Printf("[GoProxy] SUCCESS (json): b64 len=%d", len(jsonResp.Data[0].B64JSON))
				return ImageResponse{Success: true, B64JSON: jsonResp.Data[0].B64JSON, Size: len(bodyBytes)}
			}
		}

		text := string(bodyBytes)
		if strings.Contains(text, "event:") || strings.Contains(text, "data:") {
			lines := strings.Split(text, "\n")
			var foundB64 string
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if !strings.HasPrefix(line, "data:") {
					continue
				}
				data := strings.TrimPrefix(line, "data:")
				data = strings.TrimSpace(data)
				if data == "[DONE]" || data == "" {
					continue
				}

				var parsed map[string]interface{}
				if json.Unmarshal([]byte(data), &parsed) != nil {
					continue
				}

				if b64, ok := parsed["b64_json"].(string); ok && len(b64) > 100 {
					foundB64 = b64
				}

				if dataArr, ok := parsed["data"].([]interface{}); ok && len(dataArr) > 0 {
					if item, ok := dataArr[0].(map[string]interface{}); ok {
						if b64, ok := item["b64_json"].(string); ok && len(b64) > 100 {
							foundB64 = b64
						}
					}
				}

				if textContent, ok := parsed["text"].(string); ok && len(textContent) > 1000 && !strings.Contains(textContent, "{") {
					foundB64 = textContent
				}

				if delta, ok := parsed["delta"].(map[string]interface{}); ok {
					if textContent, ok := delta["text"].(string); ok && len(textContent) > 1000 && !strings.Contains(textContent, "{") {
						foundB64 = textContent
					}
				}

				if content, ok := parsed["content"].([]interface{}); ok {
					for _, c := range content {
						if item, ok := c.(map[string]interface{}); ok {
							if b64, ok := item["b64_json"].(string); ok && len(b64) > 100 {
								foundB64 = b64
							}
						}
					}
				}
			}

			if foundB64 != "" {
				log.Printf("[GoProxy] SUCCESS (sse): b64 len=%d", len(foundB64))
				return ImageResponse{Success: true, B64JSON: foundB64, Size: len(bodyBytes)}
			}
		}

		log.Printf("[GoProxy] Unknown format, body=%d bytes, preview: %s", len(bodyBytes), string(bodyBytes[:min(300, len(bodyBytes))]))
	}

	return ImageResponse{Error: "All attempts failed"}
}

func base64Encode(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

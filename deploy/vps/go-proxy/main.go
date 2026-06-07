package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
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

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "20129"
	}
	apiURL := os.Getenv("NINEROUTER_URL")
	if apiURL == "" {
		apiURL = "http://54.179.142.26:20128"
	}
	apiKey := os.Getenv("NINEROUTER_API_KEY")
	if apiKey == "" {
		apiKey = "sk-4ab3e463a07ad0cd-939969-c4fd7754"
	}

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

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	})

	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	})

	log.Printf("[GoProxy] Starting on :%s", port)
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

		client := &http.Client{Timeout: 90 * time.Second}
		body, _ := json.Marshal(req)
		endpoint := fmt.Sprintf("%s/v1/images/generations?response_format=binary", apiURL)

		httpReq, err := http.NewRequest("POST", endpoint, stringReader(body))
		if err != nil {
			log.Printf("[GoProxy] Request build error: %v", err)
			continue
		}
		httpReq.Header.Set("Content-Type", "application/json")
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

		if ct == "" || ct == "application/octet-stream" || len(ct) >= 5 && ct[:5] == "image" {
			bodyBytes, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				log.Printf("[GoProxy] Read error: %v", err)
				continue
			}
			log.Printf("[GoProxy] SUCCESS: %d bytes in %.1fs", len(bodyBytes), elapsed)
			return ImageResponse{
				Success: true,
				B64JSON: base64Encode(bodyBytes),
				Size:    len(bodyBytes),
			}
		}

		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

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

		log.Printf("[GoProxy] Unknown response format: %s", string(bodyBytes[:min(200, len(bodyBytes))]))
	}

	return ImageResponse{Error: "All attempts failed"}
}

func base64Encode(data []byte) string {
	const encodeStd = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	n := len(data)
	encoded := make([]byte, (n+2)/3*4)
	for i, j := 0, 0; i < n; {
		val := uint(data[i]) << 16
		if i+1 < n {
			val |= uint(data[i+1]) << 8
		}
		if i+2 < n {
			val |= uint(data[i+2])
		}
		encoded[j] = encodeStd[(val>>18)&0x3F]
		encoded[j+1] = encodeStd[(val>>12)&0x3F]
		if i+1 < n {
			encoded[j+2] = encodeStd[(val>>6)&0x3F]
		} else {
			encoded[j+2] = '='
		}
		if i+2 < n {
			encoded[j+3] = encodeStd[val&0x3F]
		} else {
			encoded[j+3] = '='
		}
		i += 3
		j += 4
	}
	return string(encoded)
}

func stringReader(data []byte) io.Reader {
	return &byteReader{data: data, pos: 0}
}

type byteReader struct {
	data []byte
	pos  int
}

func (r *byteReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

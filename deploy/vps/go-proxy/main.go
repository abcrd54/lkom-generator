package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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

var s3Client *s3.Client
var r2Bucket string

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

	r2Bucket = os.Getenv("R2_BUCKET_NAME")
	if r2Bucket == "" {
		r2Bucket = "lkom"
	}

	r2AccountID := os.Getenv("R2_ACCOUNT_ID")
	r2AccessKey := os.Getenv("R2_ACCESS_KEY_ID")
	r2SecretKey := os.Getenv("R2_SECRET_ACCESS_KEY")

	if r2AccountID != "" && r2AccessKey != "" && r2SecretKey != "" {
		cfg, err := awsconfig.LoadDefaultConfig(context.TODO(),
			awsconfig.WithRegion("auto"),
			awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(r2AccessKey, r2SecretKey, "")),
		)
		if err != nil {
			log.Printf("[GoProxy] Failed to load AWS config: %v", err)
		} else {
			s3Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
				o.BaseEndpoint = aws.String(fmt.Sprintf("https://%s.r2.cloudflarestorage.com", r2AccountID))
			})
			log.Printf("[GoProxy] R2 S3 client initialized (bucket=%s)", r2Bucket)
		}
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

		log.Printf("[GoProxy] Result: success=%v, size=%d, error=%s", result.Success, result.Size, result.Error)

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

func downloadFromR2(r2URL string) (string, error) {
	if s3Client == nil {
		return "", fmt.Errorf("R2 client not initialized")
	}

	key := extractR2Key(r2URL)
	if key == "" {
		return "", fmt.Errorf("not an R2 URL: %s", r2URL[:min(80, len(r2URL))])
	}

	log.Printf("[GoProxy] Downloading from R2: %s", key)

	result, err := s3Client.GetObject(context.TODO(), &s3.GetObjectInput{
		Bucket: aws.String(r2Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return "", fmt.Errorf("R2 GetObject failed: %v", err)
	}
	defer result.Body.Close()

	body, err := io.ReadAll(result.Body)
	if err != nil {
		return "", fmt.Errorf("R2 read body failed: %v", err)
	}

	ct := "image/jpeg"
	if result.ContentType != nil {
		ct = *result.ContentType
	}

	dataURL := "data:" + ct + ";base64," + base64Encode(body)
	log.Printf("[GoProxy] R2 download success: %d bytes -> data URL %d chars", len(body), len(dataURL))
	return dataURL, nil
}

func extractR2Key(url string) string {
	if strings.Contains(url, "r2.cloudflarestorage.com") {
		parts := strings.SplitN(url, ".r2.cloudflarestorage.com/", 2)
		if len(parts) == 2 {
			return parts[1]
		}
	}

	if strings.Contains(url, "storage.lkom.cloud/") {
		parts := strings.SplitN(url, "storage.lkom.cloud/", 2)
		if len(parts) == 2 {
			return parts[1]
		}
	}

	return ""
}

func isR2URL(url string) bool {
	return strings.Contains(url, "r2.cloudflarestorage.com") || strings.Contains(url, "storage.lkom.cloud")
}

func generateImage(apiURL, apiKey string, req ImageRequest) ImageResponse {
	if req.Image != "" && strings.HasPrefix(req.Image, "http") {
		var dataURL string
		var err error

		if isR2URL(req.Image) {
			dataURL, err = downloadFromR2(req.Image)
		} else {
			dataURL, err = downloadAsDataURL(req.Image)
		}

		if err != nil {
			log.Printf("[GoProxy] Failed to download image: %v", err)
			return ImageResponse{Error: fmt.Sprintf("Failed to download reference image: %v", err)}
		}
		req.Image = dataURL
		log.Printf("[GoProxy] Image converted to data URL: %d chars", len(dataURL))
	}

	if len(req.Images) > 0 {
		for i, img := range req.Images {
			if strings.HasPrefix(img, "http") {
				var dataURL string
				var err error

				if isR2URL(img) {
					dataURL, err = downloadFromR2(img)
				} else {
					dataURL, err = downloadAsDataURL(img)
				}

				if err != nil {
					log.Printf("[GoProxy] Failed to download image[%d]: %v", i, err)
					return ImageResponse{Error: fmt.Sprintf("Failed to download reference image[%d]: %v", i, err)}
				}
				req.Images[i] = dataURL
			}
		}
	}

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

		text := string(bodyBytes)
		if strings.Contains(text, "event:") && strings.Contains(text, "data:") {
			lines := strings.Split(text, "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "data:") {
					data := strings.TrimPrefix(line, "data:")
					data = strings.TrimSpace(data)
					if data == "[DONE]" || data == "" {
						continue
					}
					var parsed map[string]interface{}
					if json.Unmarshal([]byte(data), &parsed) == nil {
						if b64, ok := parsed["b64_json"].(string); ok && len(b64) > 100 {
							log.Printf("[GoProxy] SUCCESS (sse): b64 len=%d", len(b64))
							return ImageResponse{Success: true, B64JSON: b64, Size: len(bodyBytes)}
						}
						if dataArr, ok := parsed["data"].([]interface{}); ok && len(dataArr) > 0 {
							if item, ok := dataArr[0].(map[string]interface{}); ok {
								if b64, ok := item["b64_json"].(string); ok && len(b64) > 100 {
									log.Printf("[GoProxy] SUCCESS (sse data): b64 len=%d", len(b64))
									return ImageResponse{Success: true, B64JSON: b64, Size: len(bodyBytes)}
								}
							}
						}
					}
				}
			}
		}

		log.Printf("[GoProxy] Unknown format, preview: %s", string(bodyBytes[:min(300, len(bodyBytes))]))
	}

	return ImageResponse{Error: "All attempts failed"}
}

func downloadAsDataURL(url string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	ct := resp.Header.Get("Content-Type")
	if ct == "" {
		ct = "image/jpeg"
	}

	return "data:" + ct + ";base64," + base64Encode(body), nil
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

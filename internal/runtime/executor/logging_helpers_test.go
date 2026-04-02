package executor

import (
	"bytes"
	"context"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func TestAppendAPIResponseChunkUsesMutableBuffer(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ginCtx, _ := gin.CreateTestContext(recorder)
	ctx := context.WithValue(context.Background(), "gin", ginCtx)
	cfg := &config.Config{SDKConfig: config.SDKConfig{RequestLog: true}}

	recordAPIResponseMetadata(ctx, cfg, 200, nil)
	appendAPIResponseChunk(ctx, cfg, []byte("first"))
	appendAPIResponseChunk(ctx, cfg, []byte("second"))

	raw, exists := ginCtx.Get(apiResponseKey)
	if !exists {
		t.Fatal("expected aggregated API response to be stored")
	}
	buffer, ok := raw.(*bytes.Buffer)
	if !ok {
		t.Fatalf("aggregated API response type = %T, want *bytes.Buffer", raw)
	}
	got := buffer.String()
	if !bytes.Contains([]byte(got), []byte("first")) || !bytes.Contains([]byte(got), []byte("second")) {
		t.Fatalf("aggregated API response = %q, want both chunks present", got)
	}
}

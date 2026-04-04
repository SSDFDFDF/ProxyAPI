package helps

import (
	"context"
	"net/http"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
)

func TestNewProxyAwareHTTPClientDirectBypassesGlobalProxy(t *testing.T) {
	t.Parallel()

	client := NewProxyAwareHTTPClient(
		context.Background(),
		&config.Config{SDKConfig: sdkconfig.SDKConfig{ProxyURL: "http://global-proxy.example.com:8080"}},
		&cliproxyauth.Auth{ProxyURL: "direct"},
		0,
	)

	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("expected direct transport to disable proxy function")
	}
}

func TestNewProxyAwareHTTPClientReusesProxyTransport(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{SDKConfig: sdkconfig.SDKConfig{ProxyURL: "http://global-proxy.example.com:8080"}}

	clientA := newProxyAwareHTTPClient(context.Background(), cfg, nil, 0)
	clientB := newProxyAwareHTTPClient(context.Background(), cfg, nil, 0)

	if clientA.Transport == nil || clientB.Transport == nil {
		t.Fatalf("expected proxy-backed transports, got %T and %T", clientA.Transport, clientB.Transport)
	}
	if clientA.Transport != clientB.Transport {
		t.Fatal("expected proxy-aware clients to reuse the same transport for identical proxy settings")
	}
}

func TestNewProxyAwareHTTPClientReusesResinRoundTripper(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			ResinURL:          "http://127.0.0.1:2260/my-token",
			ResinPlatformName: "Default",
		},
	}
	auth := &cliproxyauth.Auth{
		Provider: "codex",
		Metadata: map[string]any{"account_id": "user@example.com"},
	}

	clientA := newProxyAwareHTTPClient(context.Background(), cfg, auth, 0)
	clientB := newProxyAwareHTTPClient(context.Background(), cfg, auth, 0)

	if clientA.Transport == nil || clientB.Transport == nil {
		t.Fatalf("expected resin-backed transports, got %T and %T", clientA.Transport, clientB.Transport)
	}
	if clientA.Transport != clientB.Transport {
		t.Fatal("expected resin-backed clients to reuse the same round tripper for identical identities")
	}
}

package helps

import (
	"context"
	"net/http"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
)

func proxyURLFromTransport(t *testing.T, rt http.RoundTripper) string {
	t.Helper()

	transport, ok := rt.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", rt)
	}
	if transport.Proxy == nil {
		return ""
	}
	req, err := http.NewRequest(http.MethodGet, "https://example.com", nil)
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	proxyURL, err := transport.Proxy(req)
	if err != nil {
		t.Fatalf("transport.Proxy returned error: %v", err)
	}
	if proxyURL == nil {
		return ""
	}
	return proxyURL.String()
}

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

func TestNewProxyAwareHTTPClientUsesAIProvidersCategoryProxy(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			Proxy: config.ProxyConfig{
				Profiles: map[string]config.ProxyProfile{
					"ai-http": {ProxyURL: "http://ai-proxy.example.com:8080"},
				},
				AIProviders: "ai-http",
			},
		},
	}
	auth := &cliproxyauth.Auth{
		Attributes: map[string]string{"source": "config:codex[token]"},
	}

	client := NewProxyAwareHTTPClient(context.Background(), cfg, auth, 0)
	if got := proxyURLFromTransport(t, client.Transport); got != "http://ai-proxy.example.com:8080" {
		t.Fatalf("proxy url = %q, want %q", got, "http://ai-proxy.example.com:8080")
	}
}

func TestNewProxyAwareHTTPClientUsesAuthFilesCategoryDirect(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			ProxyURL: "http://global-proxy.example.com:8080",
			Proxy: config.ProxyConfig{
				AuthFiles: "direct",
			},
		},
	}
	auth := &cliproxyauth.Auth{
		FileName:   "gemini-user.json",
		Attributes: map[string]string{"path": "/tmp/gemini-user.json"},
	}

	client := NewProxyAwareHTTPClient(context.Background(), cfg, auth, 0)
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("expected auth-files direct transport to disable proxy function")
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

func TestNewProxyAwareHTTPClientExplicitProxyDisablesInheritedResin(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			Proxy: config.ProxyConfig{
				Profiles: map[string]config.ProxyProfile{
					"runtime-resin": {
						ResinURL:          "http://127.0.0.1:2260/my-token",
						ResinPlatformName: "Default",
					},
				},
				AIProviders: "runtime-resin",
			},
		},
	}
	auth := &cliproxyauth.Auth{
		Provider: "codex",
		ProxyURL: "direct",
		Metadata: map[string]any{"account_id": "user@example.com"},
	}

	client := newProxyAwareHTTPClient(context.Background(), cfg, auth, 0)
	transport, ok := client.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport type = %T, want *http.Transport", client.Transport)
	}
	if transport.Proxy != nil {
		t.Fatal("expected explicit auth proxy to bypass inherited resin and disable proxy function")
	}
}

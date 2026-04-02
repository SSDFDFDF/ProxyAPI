package resin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

func TestParseConfigAndRouteHelpers(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: config.SDKConfig{
			ResinURL:          "http://127.0.0.1:2260/my-token",
			ResinPlatformName: "Default",
		},
	}

	parsed, err := ParseConfig(cfg)
	if err != nil {
		t.Fatalf("ParseConfig returned error: %v", err)
	}
	if parsed == nil {
		t.Fatal("ParseConfig returned nil config")
	}

	httpTarget, _ := url.Parse("https://api.example.com/healthz?ready=1")
	httpURL, err := parsed.ReverseURL(httpTarget)
	if err != nil {
		t.Fatalf("ReverseURL(http) returned error: %v", err)
	}
	if got, want := httpURL.String(), "http://127.0.0.1:2260/my-token/Default/https/api.example.com/healthz?ready=1"; got != want {
		t.Fatalf("ReverseURL(http) = %q, want %q", got, want)
	}

	wsTarget, _ := url.Parse("wss://ws.example.com/chat")
	wsURL, err := parsed.ReverseURL(wsTarget)
	if err != nil {
		t.Fatalf("ReverseURL(ws) returned error: %v", err)
	}
	if got, want := wsURL.String(), "ws://127.0.0.1:2260/my-token/Default/https/ws.example.com/chat"; got != want {
		t.Fatalf("ReverseURL(ws) = %q, want %q", got, want)
	}

	forwardProxyURL, err := parsed.ForwardProxyURL("codex:user@example.com")
	if err != nil {
		t.Fatalf("ForwardProxyURL returned error: %v", err)
	}
	parsedProxy, err := url.Parse(forwardProxyURL)
	if err != nil {
		t.Fatalf("Parse(forwardProxyURL) returned error: %v", err)
	}
	if got, want := parsedProxy.Scheme, "http"; got != want {
		t.Fatalf("forward proxy scheme = %q, want %q", got, want)
	}
	if got, want := parsedProxy.Host, "127.0.0.1:2260"; got != want {
		t.Fatalf("forward proxy host = %q, want %q", got, want)
	}
	if got, want := parsedProxy.User.Username(), "Default.codex:user@example.com"; got != want {
		t.Fatalf("forward proxy username = %q, want %q", got, want)
	}
	password, _ := parsedProxy.User.Password()
	if got, want := password, "my-token"; got != want {
		t.Fatalf("forward proxy password = %q, want %q", got, want)
	}
}

func TestWrapRoundTripperReverseRouting(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: config.SDKConfig{
			ResinURL:          "http://127.0.0.1:2260/my-token",
			ResinPlatformName: "Default",
		},
	}

	type capturedRequest struct {
		URL    string
		Header http.Header
	}

	var captured capturedRequest
	base := roundTripperFunc(func(req *http.Request) (*http.Response, error) {
		captured.URL = req.URL.String()
		captured.Header = req.Header.Clone()
		return &http.Response{
			StatusCode: http.StatusNoContent,
			Body:       http.NoBody,
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})

	wrapped, err := WrapRoundTripper(cfg, base, Identity{
		Provider: "codex",
		Account:  "codex:user@example.com",
		Mode:     ModeReverse,
	})
	if err != nil {
		t.Fatalf("WrapRoundTripper returned error: %v", err)
	}

	req, err := http.NewRequest(http.MethodGet, "https://api.example.com/v1/models?limit=1", nil)
	if err != nil {
		t.Fatalf("http.NewRequest returned error: %v", err)
	}
	if _, err := wrapped.RoundTrip(req); err != nil {
		t.Fatalf("RoundTrip returned error: %v", err)
	}

	if got, want := captured.URL, "http://127.0.0.1:2260/my-token/Default/https/api.example.com/v1/models?limit=1"; got != want {
		t.Fatalf("captured url = %q, want %q", got, want)
	}
	if got, want := captured.Header.Get(AccountHeader), "codex:user@example.com"; got != want {
		t.Fatalf("%s header = %q, want %q", AccountHeader, got, want)
	}
}

func TestInheritLeasePostsExpectedPayload(t *testing.T) {
	t.Parallel()

	var (
		gotPath string
		gotBody map[string]string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		defer func() {
			_ = r.Body.Close()
		}()
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("Decode request body returned error: %v", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	cfg := &config.Config{
		SDKConfig: config.SDKConfig{
			ResinURL:          server.URL + "/my-token",
			ResinPlatformName: "Default",
		},
	}

	if err := InheritLease(context.Background(), cfg, "codex:temp:123", "codex:user@example.com"); err != nil {
		t.Fatalf("InheritLease returned error: %v", err)
	}
	if got, want := gotPath, "/my-token/api/v1/Default/actions/inherit-lease"; got != want {
		t.Fatalf("request path = %q, want %q", got, want)
	}
	if got, want := gotBody["parent_account"], "codex:temp:123"; got != want {
		t.Fatalf("parent_account = %q, want %q", got, want)
	}
	if got, want := gotBody["new_account"], "codex:user@example.com"; got != want {
		t.Fatalf("new_account = %q, want %q", got, want)
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

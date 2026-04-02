package executor

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/resin"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/proxyutil"
	log "github.com/sirupsen/logrus"
)

// newProxyAwareHTTPClient creates an HTTP client with proper proxy configuration priority:
// 1. Use auth.ProxyURL if configured (highest priority)
// 2. Use cfg.ProxyURL if auth proxy is not configured
// 3. Use RoundTripper from context if neither are configured
//
// Parameters:
//   - ctx: The context containing optional RoundTripper
//   - cfg: The application configuration
//   - auth: The authentication information
//   - timeout: The client timeout (0 means no timeout)
//
// Returns:
//   - *http.Client: An HTTP client with configured proxy or transport
func newProxyAwareHTTPClient(ctx context.Context, cfg *config.Config, auth *cliproxyauth.Auth, timeout time.Duration) *http.Client {
	httpClient := &http.Client{}
	if timeout > 0 {
		httpClient.Timeout = timeout
	}

	var baseTransport http.RoundTripper

	// Priority 1: Use auth.ProxyURL if configured
	var proxyURL string
	if auth != nil {
		proxyURL = strings.TrimSpace(auth.ProxyURL)
	}

	// Priority 2: Use cfg.ProxyURL if auth proxy is not configured
	if proxyURL == "" && cfg != nil {
		proxyURL = strings.TrimSpace(cfg.ProxyURL)
	}

	// If we have a proxy URL configured, set up the transport
	if proxyURL != "" {
		transport := buildProxyTransport(proxyURL)
		if transport != nil {
			baseTransport = transport
		}
	}

	if baseTransport == nil {
		// Priority 3: Use RoundTripper from context (typically from RoundTripperFor)
		if rt, ok := ctx.Value("cliproxy.roundtripper").(http.RoundTripper); ok && rt != nil {
			baseTransport = rt
		}
	}

	// Resin reverse proxy rewrites the URL to point at the Resin server directly,
	// so the underlying transport must NOT also route through the original proxy —
	// that would cause double-proxying. Pass nil so Resin uses a clean transport.
	if wrapped := wrapResinRoundTripper(cfg, auth, nil); wrapped != nil {
		httpClient.Transport = wrapped
		return httpClient
	}

	if baseTransport != nil {
		httpClient.Transport = baseTransport
	}

	return httpClient
}

// buildProxyTransport creates an HTTP transport configured for the given proxy URL.
// It supports SOCKS5, HTTP, and HTTPS proxy protocols.
//
// Parameters:
//   - proxyURL: The proxy URL string (e.g., "socks5://user:pass@host:port", "http://host:port")
//
// Returns:
//   - *http.Transport: A configured transport, or nil if the proxy URL is invalid
func buildProxyTransport(proxyURL string) *http.Transport {
	transport, _, errBuild := proxyutil.BuildHTTPTransport(proxyURL)
	if errBuild != nil {
		log.Errorf("%v", errBuild)
		return nil
	}
	return transport
}

func wrapResinRoundTripper(cfg *config.Config, auth *cliproxyauth.Auth, base http.RoundTripper) http.RoundTripper {
	if auth == nil || cfg == nil {
		return base
	}

	account := resin.StableAccount(auth.Provider, auth.Attributes, auth.Metadata, auth.EnsureIndex())
	if account == "" {
		return base
	}

	wrapped, err := resin.WrapRoundTripper(cfg, base, resin.Identity{
		Provider: auth.Provider,
		Account:  account,
		Mode:     resin.ModeReverse,
	})
	if err != nil {
		log.Errorf("resin runtime routing disabled: %v", err)
		return base
	}
	return wrapped
}

func configWithResinForwardProxy(cfg *config.Config, auth *cliproxyauth.Auth) *config.Config {
	if cfg == nil || auth == nil {
		return cfg
	}

	account := resin.StableAccount(auth.Provider, auth.Attributes, auth.Metadata, auth.EnsureIndex())
	if account == "" {
		return cfg
	}

	clone, _, err := resin.CloneConfigWithForwardProxy(cfg, resin.Identity{
		Provider: auth.Provider,
		Account:  account,
		Mode:     resin.ModeForward,
	})
	if err != nil {
		log.Errorf("resin auth routing disabled: %v", err)
		return cfg
	}
	return clone
}

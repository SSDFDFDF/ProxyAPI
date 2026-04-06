package proxycfg

import (
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v6/sdk/config"
)

func TestResolveScopeProxyURL(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			Proxy: config.ProxyConfig{
				Profiles: map[string]config.ProxyProfile{
					"default": {ProxyURL: "http://global-proxy.example.com:8080"},
					"ai-http": {ProxyURL: "http://ai-proxy.example.com:8080"},
				},
				Default:     "default",
				AIProviders: "ai-http",
				AuthFiles:   "direct",
			},
		},
	}

	if got := ResolveScopeProxyURL(cfg, ScopeAIProviders); got != "http://ai-proxy.example.com:8080" {
		t.Fatalf("ResolveScopeProxyURL(ai-providers) = %q, want %q", got, "http://ai-proxy.example.com:8080")
	}
	if got := ResolveScopeProxyURL(cfg, ScopeAuthFiles); got != "direct" {
		t.Fatalf("ResolveScopeProxyURL(auth-files) = %q, want %q", got, "direct")
	}
	if got := ResolveScopeProxyURL(cfg, ScopeOAuthLogin); got != "http://global-proxy.example.com:8080" {
		t.Fatalf("ResolveScopeProxyURL(oauth-login) = %q, want %q", got, "http://global-proxy.example.com:8080")
	}
}

func TestResolveScopeUsesLegacyFieldsAsDefaultProfile(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			ProxyURL:          "http://legacy-proxy.example.com:8080",
			ResinURL:          "http://legacy-resin.example.com/token",
			ResinPlatformName: "Legacy",
		},
	}

	resolved := ResolveScope(cfg, ScopeDefault)
	if got := resolved.ProxyURL; got != "http://legacy-proxy.example.com:8080" {
		t.Fatalf("resolved.ProxyURL = %q, want %q", got, "http://legacy-proxy.example.com:8080")
	}
	if got := resolved.ResinURL; got != "http://legacy-resin.example.com/token" {
		t.Fatalf("resolved.ResinURL = %q, want %q", got, "http://legacy-resin.example.com/token")
	}
	if got := resolved.ResinPlatformName; got != "Legacy" {
		t.Fatalf("resolved.ResinPlatformName = %q, want %q", got, "Legacy")
	}
}

func TestRuntimeScope(t *testing.T) {
	t.Parallel()

	configAuth := &coreauth.Auth{
		Attributes: map[string]string{"source": "config:gemini[token]"},
	}
	if got := RuntimeScope(configAuth); got != ScopeAIProviders {
		t.Fatalf("RuntimeScope(config auth) = %q, want %q", got, ScopeAIProviders)
	}

	fileAuth := &coreauth.Auth{
		FileName:   "gemini-user.json",
		Attributes: map[string]string{"source": "/tmp/gemini-user.json"},
		Provider:   "gemini-cli",
		Metadata:   map[string]any{"email": "user@example.com"},
	}
	if got := RuntimeScope(fileAuth); got != ScopeAuthFiles {
		t.Fatalf("RuntimeScope(file auth) = %q, want %q", got, ScopeAuthFiles)
	}
}

func TestResolveRuntimeProxyURL(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			Proxy: config.ProxyConfig{
				Profiles: map[string]config.ProxyProfile{
					"default":   {ProxyURL: "http://global-proxy.example.com:8080"},
					"ai-http":   {ProxyURL: "http://ai-proxy.example.com:8080"},
					"auth-http": {ProxyURL: "http://auth-proxy.example.com:8080"},
				},
				Default:     "default",
				AIProviders: "ai-http",
				AuthFiles:   "auth-http",
			},
		},
	}

	if got := ResolveRuntimeProxyURL(cfg, &coreauth.Auth{
		ProxyURL:   "direct",
		Attributes: map[string]string{"source": "config:codex[token]"},
	}); got != "direct" {
		t.Fatalf("ResolveRuntimeProxyURL(explicit) = %q, want %q", got, "direct")
	}

	if got := ResolveRuntimeProxyURL(cfg, &coreauth.Auth{
		Attributes: map[string]string{"source": "config:codex[token]"},
	}); got != "http://ai-proxy.example.com:8080" {
		t.Fatalf("ResolveRuntimeProxyURL(config auth) = %q, want %q", got, "http://ai-proxy.example.com:8080")
	}

	if got := ResolveRuntimeProxyURL(cfg, &coreauth.Auth{
		FileName:   "claude-user.json",
		Attributes: map[string]string{"path": "/tmp/claude-user.json"},
	}); got != "http://auth-proxy.example.com:8080" {
		t.Fatalf("ResolveRuntimeProxyURL(file auth) = %q, want %q", got, "http://auth-proxy.example.com:8080")
	}
}

func TestCloneWithScopeUsesProfileResinConfig(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			Proxy: config.ProxyConfig{
				Profiles: map[string]config.ProxyProfile{
					"default": {
						ProxyURL:          "http://global-proxy.example.com:8080",
						ResinURL:          "http://legacy-resin.example.com/token",
						ResinPlatformName: "Legacy",
					},
					"oauth-resin": {
						ResinURL:          "http://oauth-resin.example.com/token",
						ResinPlatformName: "OAuth",
					},
				},
				Default:    "default",
				OAuthLogin: "oauth-resin",
			},
		},
	}

	effective := CloneWithScope(cfg, ScopeOAuthLogin)
	if effective == nil {
		t.Fatal("CloneWithScope returned nil config")
	}
	if got := effective.ProxyURL; got != "" {
		t.Fatalf("effective.ProxyURL = %q, want empty", got)
	}
	if got := effective.ResinURL; got != "http://oauth-resin.example.com/token" {
		t.Fatalf("effective.ResinURL = %q, want %q", got, "http://oauth-resin.example.com/token")
	}
	if got := effective.ResinPlatformName; got != "OAuth" {
		t.Fatalf("effective.ResinPlatformName = %q, want %q", got, "OAuth")
	}
}

func TestCloneWithRuntimeExplicitProxyDisablesInheritedResin(t *testing.T) {
	t.Parallel()

	cfg := &config.Config{
		SDKConfig: sdkconfig.SDKConfig{
			Proxy: config.ProxyConfig{
				Profiles: map[string]config.ProxyProfile{
					"default": {
						ResinURL:          "http://shared-resin.example.com/token",
						ResinPlatformName: "Shared",
					},
					"runtime-resin": {
						ResinURL:          "http://runtime-resin.example.com/token",
						ResinPlatformName: "Runtime",
					},
				},
				Default:     "default",
				AIProviders: "runtime-resin",
			},
		},
	}

	effective := CloneWithRuntime(cfg, &coreauth.Auth{
		ProxyURL:   "direct",
		Attributes: map[string]string{"source": "config:codex[token]"},
	})
	if effective == nil {
		t.Fatal("CloneWithRuntime returned nil config")
	}
	if got := effective.ProxyURL; got != "direct" {
		t.Fatalf("effective.ProxyURL = %q, want %q", got, "direct")
	}
	if got := effective.ResinURL; got != "" {
		t.Fatalf("effective.ResinURL = %q, want empty", got)
	}
	if got := effective.ResinPlatformName; got != "" {
		t.Fatalf("effective.ResinPlatformName = %q, want empty", got)
	}
}

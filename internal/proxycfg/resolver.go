package proxycfg

import (
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

// Scope identifies a category-level proxy default.
type Scope string

const (
	ScopeDefault     Scope = "default"
	ScopeAIProviders Scope = "ai-providers"
	ScopeAuthFiles   Scope = "auth-files"
	ScopeOAuthLogin  Scope = "oauth-login"
)

// Resolved captures the effective network configuration after applying a selector.
type Resolved struct {
	Scope             Scope
	Selection         string
	ProxyURL          string
	ResinURL          string
	ResinPlatformName string
}

// ResolveScope resolves the effective network configuration for one scope.
func ResolveScope(cfg *config.Config, scope Scope) Resolved {
	cfg = config.CloneNormalizedProxyConfig(cfg)
	resolved := resolveSelection(cfg, selectorForScope(cfg, scope))
	resolved.Scope = scope
	return resolved
}

// ResolveRuntimeProxyURL resolves the effective runtime proxy for an auth entry.
// An auth-level ProxyURL always wins. Otherwise the auth source decides which
// category-level default is used.
func ResolveRuntimeProxyURL(cfg *config.Config, auth *coreauth.Auth) string {
	return ResolveRuntime(cfg, auth).ProxyURL
}

// ResolveScopeProxyURL resolves just the effective proxy URL for one scope.
func ResolveScopeProxyURL(cfg *config.Config, scope Scope) string {
	return ResolveScope(cfg, scope).ProxyURL
}

// ResolveRuntime resolves the effective network configuration for runtime auth traffic.
// An auth-level ProxyURL always wins and also disables inherited Resin settings.
func ResolveRuntime(cfg *config.Config, auth *coreauth.Auth) Resolved {
	scope := RuntimeScope(auth)
	if auth != nil {
		if proxyURL := strings.TrimSpace(auth.ProxyURL); proxyURL != "" {
			return Resolved{
				Scope:     scope,
				Selection: "auth-proxy-url",
				ProxyURL:  proxyURL,
			}
		}
	}
	return ResolveScope(cfg, scope)
}

// RuntimeScope classifies runtime traffic into ai-providers vs auth-files.
func RuntimeScope(auth *coreauth.Auth) Scope {
	if isAuthFileBacked(auth) {
		return ScopeAuthFiles
	}
	return ScopeAIProviders
}

// CloneWithScope returns a shallow config clone with ProxyURL rewritten to the
// resolved scope configuration.
func CloneWithScope(cfg *config.Config, scope Scope) *config.Config {
	return CloneWithResolved(cfg, ResolveScope(cfg, scope))
}

// CloneWithRuntime returns a shallow config clone with ProxyURL rewritten to the
// resolved runtime proxy for the provided auth entry.
func CloneWithRuntime(cfg *config.Config, auth *coreauth.Auth) *config.Config {
	return CloneWithResolved(cfg, ResolveRuntime(cfg, auth))
}

// CloneWithResolved returns a shallow config clone with the resolved network config applied.
func CloneWithResolved(cfg *config.Config, resolved Resolved) *config.Config {
	if cfg == nil {
		return &config.Config{
			SDKConfig: config.SDKConfig{
				ProxyURL:          strings.TrimSpace(resolved.ProxyURL),
				ResinURL:          strings.TrimSpace(resolved.ResinURL),
				ResinPlatformName: strings.TrimSpace(resolved.ResinPlatformName),
			},
		}
	}

	clone := *cfg
	clone.ProxyURL = strings.TrimSpace(resolved.ProxyURL)
	clone.ResinURL = strings.TrimSpace(resolved.ResinURL)
	clone.ResinPlatformName = strings.TrimSpace(resolved.ResinPlatformName)
	return &clone
}

// CloneWithProxyURL returns a shallow config clone with a normalized ProxyURL while
// clearing inherited Resin settings. Use this for explicit per-auth overrides.
func CloneWithProxyURL(cfg *config.Config, proxyURL string) *config.Config {
	return CloneWithResolved(cfg, Resolved{ProxyURL: proxyURL})
}

func selectorForScope(cfg *config.Config, scope Scope) string {
	if cfg == nil {
		return ""
	}
	switch scope {
	case ScopeDefault:
		return strings.TrimSpace(cfg.Proxy.Default)
	case ScopeAuthFiles:
		if selector := strings.TrimSpace(cfg.Proxy.AuthFiles); selector != "" {
			return selector
		}
		return strings.TrimSpace(cfg.Proxy.Default)
	case ScopeOAuthLogin:
		if selector := strings.TrimSpace(cfg.Proxy.OAuthLogin); selector != "" {
			return selector
		}
		return strings.TrimSpace(cfg.Proxy.Default)
	case ScopeAIProviders:
		fallthrough
	default:
		if selector := strings.TrimSpace(cfg.Proxy.AIProviders); selector != "" {
			return selector
		}
		return strings.TrimSpace(cfg.Proxy.Default)
	}
}

func resolveSelection(cfg *config.Config, selection string) Resolved {
	selection = strings.TrimSpace(selection)
	if selection == "" {
		return Resolved{}
	}
	if strings.EqualFold(selection, "direct") || strings.EqualFold(selection, "none") {
		return Resolved{
			Selection: selection,
			ProxyURL:  selection,
		}
	}
	if cfg == nil || len(cfg.Proxy.Profiles) == 0 {
		return Resolved{}
	}
	profile, ok := cfg.Proxy.Profiles[selection]
	if !ok {
		return Resolved{Selection: selection}
	}
	return Resolved{
		Selection:         selection,
		ProxyURL:          strings.TrimSpace(profile.ProxyURL),
		ResinURL:          strings.TrimSpace(profile.ResinURL),
		ResinPlatformName: strings.TrimSpace(profile.ResinPlatformName),
	}
}

func isAuthFileBacked(auth *coreauth.Auth) bool {
	if auth == nil {
		return false
	}

	source := ""
	if len(auth.Attributes) > 0 {
		source = strings.ToLower(strings.TrimSpace(auth.Attributes["source"]))
	}
	if strings.HasPrefix(source, "config:") {
		return false
	}

	if strings.TrimSpace(auth.FileName) != "" {
		return true
	}
	if len(auth.Attributes) > 0 && strings.TrimSpace(auth.Attributes["path"]) != "" {
		return true
	}
	return source != ""
}

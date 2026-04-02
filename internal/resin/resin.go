package resin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
)

const AccountHeader = "X-Resin-Account"

type Mode string

const (
	ModeReverse Mode = "reverse"
	ModeForward Mode = "forward"
)

// Identity describes the Resin business identity to attach to a request set.
// Account is the stable post-login identity. TempAccount is used only when no
// stable identifier exists yet (for example, during login before user info is returned).
type Identity struct {
	Provider    string
	Account     string
	TempAccount string
	Mode        Mode
}

func (i Identity) EffectiveAccount() string {
	if account := strings.TrimSpace(i.Account); account != "" {
		return account
	}
	return strings.TrimSpace(i.TempAccount)
}

// ParsedConfig is the normalized Resin configuration.
type ParsedConfig struct {
	RawURL       string
	BaseURL      *url.URL
	PlatformName string
	Token        string
}

// ParseConfig validates and normalizes Resin settings from the application config.
// A nil ParsedConfig and nil error means Resin is disabled.
func ParseConfig(cfg *config.Config) (*ParsedConfig, error) {
	if cfg == nil {
		return nil, nil
	}

	rawURL := strings.TrimSpace(cfg.ResinURL)
	platform := strings.TrimSpace(cfg.ResinPlatformName)
	if rawURL == "" && platform == "" {
		return nil, nil
	}
	if rawURL == "" || platform == "" {
		return nil, fmt.Errorf("resin requires both resin-url and resin-platform-name")
	}
	if strings.Contains(platform, "/") {
		return nil, fmt.Errorf("resin platform name must be a single path segment")
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse resin-url failed: %w", err)
	}
	if parsedURL.Scheme == "" || parsedURL.Host == "" {
		return nil, fmt.Errorf("resin-url must include scheme and host")
	}

	token := strings.Trim(strings.TrimSpace(parsedURL.Path), "/")
	if token == "" {
		return nil, fmt.Errorf("resin-url must include the token path")
	}

	return &ParsedConfig{
		RawURL:       rawURL,
		BaseURL:      parsedURL,
		PlatformName: platform,
		Token:        token,
	}, nil
}

func ScopeAccount(provider, account string) string {
	account = strings.TrimSpace(account)
	if account == "" {
		return ""
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" || strings.HasPrefix(account, provider+":") {
		return account
	}
	return provider + ":" + account
}

// StableAccount resolves a stable account identifier from auth metadata/attributes.
// The returned value is provider-scoped to avoid collisions between upstream providers.
func StableAccount(provider string, attributes map[string]string, metadata map[string]any, fallback string) string {
	candidates := []string{
		attrValue(attributes, "resin_account"),
		metaString(metadata, "resin_account"),
		metaString(metadata, "account_id"),
		metaString(metadata, "email"),
		metaString(metadata, "alias"),
		metaString(metadata, "username"),
		metaString(metadata, "user_name"),
		metaString(metadata, "phone"),
		metaString(metadata, "account"),
		metaString(metadata, "user_id"),
		strings.TrimSpace(fallback),
	}
	for _, candidate := range candidates {
		if candidate = strings.TrimSpace(candidate); candidate != "" {
			return ScopeAccount(provider, candidate)
		}
	}
	return ""
}

func attrValue(attributes map[string]string, key string) string {
	if len(attributes) == 0 {
		return ""
	}
	return strings.TrimSpace(attributes[key])
}

func metaString(metadata map[string]any, key string) string {
	if len(metadata) == 0 {
		return ""
	}
	value, _ := metadata[key].(string)
	return strings.TrimSpace(value)
}

// NewTempAccount generates a unique Resin temp identity for a login flow.
func NewTempAccount(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		provider = "account"
	}
	return provider + ":temp:" + uuid.NewString()
}

// CloneConfigWithForwardProxy returns a shallow config copy whose proxy-url points
// at Resin's forward proxy endpoint for the supplied identity.
func CloneConfigWithForwardProxy(cfg *config.Config, identity Identity) (*config.Config, bool, error) {
	parsed, err := ParseConfig(cfg)
	if err != nil || parsed == nil {
		return cfg, false, err
	}

	account := identity.EffectiveAccount()
	if account == "" {
		return cfg, false, nil
	}

	proxyURL, err := parsed.ForwardProxyURL(account)
	if err != nil {
		return cfg, false, err
	}

	clone := *cfg
	clone.ProxyURL = proxyURL
	return &clone, true, nil
}

func (c *ParsedConfig) basePath() string {
	if c == nil || c.BaseURL == nil {
		return ""
	}
	return strings.TrimRight(c.BaseURL.Path, "/")
}

func (c *ParsedConfig) EffectiveAccount(identity Identity) string {
	if c == nil {
		return ""
	}
	return identity.EffectiveAccount()
}

func (c *ParsedConfig) ReverseURL(target *url.URL) (*url.URL, error) {
	if c == nil {
		return nil, fmt.Errorf("resin config is nil")
	}
	if target == nil {
		return nil, fmt.Errorf("target url is nil")
	}

	targetScheme := strings.ToLower(strings.TrimSpace(target.Scheme))
	resinScheme := c.BaseURL.Scheme
	protocolSegment := targetScheme
	switch targetScheme {
	case "http", "https":
	case "ws":
		protocolSegment = "http"
		resinScheme = "ws"
	case "wss":
		protocolSegment = "https"
		resinScheme = "ws"
	default:
		return nil, fmt.Errorf("unsupported reverse proxy target scheme: %s", target.Scheme)
	}

	rewritten := *c.BaseURL
	rewritten.Scheme = resinScheme
	rewritten.RawQuery = target.RawQuery
	rewritten.Fragment = ""

	targetPath := target.EscapedPath()
	if targetPath == "" {
		targetPath = "/"
	}
	rewritten.Path = c.basePath() + "/" + c.PlatformName + "/" + protocolSegment + "/" + target.Host + targetPath
	rewritten.RawPath = rewritten.Path
	return &rewritten, nil
}

func (c *ParsedConfig) ForwardProxyURL(account string) (string, error) {
	if c == nil || c.BaseURL == nil {
		return "", fmt.Errorf("resin config is nil")
	}
	account = strings.TrimSpace(account)
	if account == "" {
		return "", fmt.Errorf("resin account is required for forward proxy")
	}

	proxyURL := &url.URL{
		Scheme: c.BaseURL.Scheme,
		Host:   c.BaseURL.Host,
		User:   url.UserPassword(c.PlatformName+"."+account, c.Token),
	}
	return proxyURL.String(), nil
}

func (c *ParsedConfig) InheritLeaseURL() string {
	if c == nil || c.BaseURL == nil {
		return ""
	}
	endpoint := *c.BaseURL
	endpoint.RawQuery = ""
	endpoint.Fragment = ""
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + "/api/v1/" + c.PlatformName + "/actions/inherit-lease"
	endpoint.RawPath = endpoint.Path
	return endpoint.String()
}

// InheritLease promotes a temp identity to the stable post-login identity.
func InheritLease(ctx context.Context, cfg *config.Config, parentAccount, newAccount string) error {
	parentAccount = strings.TrimSpace(parentAccount)
	newAccount = strings.TrimSpace(newAccount)
	if parentAccount == "" || newAccount == "" || parentAccount == newAccount {
		return nil
	}

	parsed, err := ParseConfig(cfg)
	if err != nil || parsed == nil {
		return err
	}

	body, err := json.Marshal(map[string]string{
		"parent_account": parentAccount,
		"new_account":    newAccount,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, parsed.InheritLeaseURL(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("resin inherit-lease failed with status %d", resp.StatusCode)
	}
	return nil
}

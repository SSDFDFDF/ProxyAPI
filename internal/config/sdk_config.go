// Package config provides configuration management for the CLI Proxy API server.
// It handles loading and parsing YAML configuration files, and provides structured
// access to application settings including server port, authentication directory,
// debug settings, proxy configuration, and API keys.
package config

// SDKConfig represents the application's configuration, loaded from a YAML file.
type SDKConfig struct {
	// ProxyURL is a legacy migration input only.
	// When present in YAML, it is migrated into proxy.profiles on load and omitted on save.
	ProxyURL string `yaml:"proxy-url,omitempty" json:"-"`

	// Proxy configures named network profiles plus scope selectors.
	Proxy ProxyConfig `yaml:"proxy,omitempty" json:"proxy,omitempty"`

	// ResinURL is a legacy migration input only.
	// When present in YAML, it is migrated into proxy.profiles on load and omitted on save.
	ResinURL string `yaml:"resin-url,omitempty" json:"-"`

	// ResinPlatformName is a legacy migration input only.
	// When present in YAML, it is migrated into proxy.profiles on load and omitted on save.
	ResinPlatformName string `yaml:"resin-platform-name,omitempty" json:"-"`

	// EnableGeminiCLIEndpoint controls whether Gemini CLI internal endpoints (/v1internal:*) are enabled.
	// Default is false for safety; when false, /v1internal:* requests are rejected.
	EnableGeminiCLIEndpoint bool `yaml:"enable-gemini-cli-endpoint" json:"enable-gemini-cli-endpoint"`

	// ForceModelPrefix requires explicit model prefixes (e.g., "teamA/gemini-3-pro-preview")
	// to target prefixed credentials. When false, unprefixed model requests may use prefixed
	// credentials as well.
	ForceModelPrefix bool `yaml:"force-model-prefix" json:"force-model-prefix"`

	// RequestLog enables or disables detailed request logging functionality.
	RequestLog bool `yaml:"request-log" json:"request-log"`

	// APIKeys is a list of keys for authenticating clients to this proxy server.
	APIKeys []string `yaml:"api-keys" json:"api-keys"`

	// PassthroughHeaders controls whether upstream response headers are forwarded to downstream clients.
	// Default is false (disabled).
	PassthroughHeaders bool `yaml:"passthrough-headers" json:"passthrough-headers"`

	// Streaming configures server-side streaming behavior (keep-alives and safe bootstrap retries).
	Streaming StreamingConfig `yaml:"streaming" json:"streaming"`

	// NonStreamKeepAliveInterval controls how often blank lines are emitted for non-streaming responses.
	// <= 0 disables keep-alives. Value is in seconds.
	NonStreamKeepAliveInterval int `yaml:"nonstream-keepalive-interval,omitempty" json:"nonstream-keepalive-interval,omitempty"`
}

// ProxyConfig groups named network profiles plus scope selectors.
type ProxyConfig struct {
	// Profiles stores reusable named network configurations.
	Profiles map[string]ProxyProfile `yaml:"profiles,omitempty" json:"profiles,omitempty"`

	// Default selects the default profile for generic outbound traffic and for scopes
	// that do not set their own selector. Empty means no default profile is selected.
	// "direct"/"none" explicitly disables both proxy and Resin defaults.
	Default string `yaml:"default,omitempty" json:"default,omitempty"`

	// AIProviders selects the profile used by config-backed providers such as
	// gemini-api-key, claude-api-key, codex-api-key, openai-compatibility, and vertex-api-key.
	// Empty means "inherit proxy.default".
	AIProviders string `yaml:"ai-providers,omitempty" json:"ai-providers,omitempty"`

	// AuthFiles selects the profile used by file-backed credentials loaded from auth-dir.
	// Empty means "inherit proxy.default".
	AuthFiles string `yaml:"auth-files,omitempty" json:"auth-files,omitempty"`

	// OAuthLogin selects the profile used by interactive OAuth/device login flows.
	// Empty means "inherit proxy.default".
	OAuthLogin string `yaml:"oauth-login,omitempty" json:"oauth-login,omitempty"`
}

// ProxyProfile stores one reusable network profile.
// A profile may define a plain proxy, a Resin route, or both:
//   - proxy-url is used for generic/non-account traffic
//   - resin-url + resin-platform-name are used for account-scoped traffic
type ProxyProfile struct {
	// ProxyURL stores the outbound proxy URL for this profile.
	ProxyURL string `yaml:"proxy-url,omitempty" json:"proxy-url,omitempty"`

	// ResinURL points to the Resin proxy base including the token path.
	ResinURL string `yaml:"resin-url,omitempty" json:"resin-url,omitempty"`

	// ResinPlatformName is the Resin business namespace segment.
	ResinPlatformName string `yaml:"resin-platform-name,omitempty" json:"resin-platform-name,omitempty"`
}

// StreamingConfig holds server streaming behavior configuration.
type StreamingConfig struct {
	// KeepAliveSeconds controls how often the server emits SSE heartbeats (": keep-alive\n\n").
	// <= 0 disables keep-alives. Default is 0.
	KeepAliveSeconds int `yaml:"keepalive-seconds,omitempty" json:"keepalive-seconds,omitempty"`

	// BootstrapRetries controls how many times the server may retry a streaming request before any bytes are sent,
	// to allow auth rotation / transient recovery.
	// <= 0 disables bootstrap retries. Default is 0.
	BootstrapRetries int `yaml:"bootstrap-retries,omitempty" json:"bootstrap-retries,omitempty"`
}

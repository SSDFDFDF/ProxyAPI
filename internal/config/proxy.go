package config

import "strings"

const migratedDefaultProxyProfileName = "default"

// SanitizeProxyConfig migrates legacy top-level fields into proxy.profiles and normalizes
// the authoritative proxy profile configuration.
func (cfg *Config) SanitizeProxyConfig() {
	normalizeProxyConfig(cfg)
}

// CloneNormalizedProxyConfig returns a shallow config clone with normalized proxy settings.
func CloneNormalizedProxyConfig(cfg *Config) *Config {
	if cfg == nil {
		return nil
	}

	clone := *cfg
	if len(cfg.Proxy.Profiles) > 0 {
		clone.Proxy.Profiles = make(map[string]ProxyProfile, len(cfg.Proxy.Profiles))
		for name, profile := range cfg.Proxy.Profiles {
			clone.Proxy.Profiles[name] = profile
		}
	}
	normalizeProxyConfig(&clone)
	return &clone
}

func normalizeProxyConfig(cfg *Config) {
	if cfg == nil {
		return
	}

	legacyProfile := ProxyProfile{
		ProxyURL:          strings.TrimSpace(cfg.ProxyURL),
		ResinURL:          strings.TrimSpace(cfg.ResinURL),
		ResinPlatformName: strings.TrimSpace(cfg.ResinPlatformName),
	}
	cfg.ProxyURL = ""
	cfg.ResinURL = ""
	cfg.ResinPlatformName = ""

	cfg.Proxy.Default = strings.TrimSpace(cfg.Proxy.Default)
	cfg.Proxy.AIProviders = strings.TrimSpace(cfg.Proxy.AIProviders)
	cfg.Proxy.AuthFiles = strings.TrimSpace(cfg.Proxy.AuthFiles)
	cfg.Proxy.OAuthLogin = strings.TrimSpace(cfg.Proxy.OAuthLogin)

	if len(cfg.Proxy.Profiles) == 0 {
		cfg.Proxy.Profiles = nil
	} else {
		normalized := make(map[string]ProxyProfile, len(cfg.Proxy.Profiles))
		for name, profile := range cfg.Proxy.Profiles {
			trimmedName := strings.TrimSpace(name)
			if trimmedName == "" {
				continue
			}

			profile = normalizeProxyProfile(profile)
			if profile.ProxyURL == "" && profile.ResinURL == "" && profile.ResinPlatformName == "" {
				continue
			}
			normalized[trimmedName] = profile
		}
		if len(normalized) == 0 {
			cfg.Proxy.Profiles = nil
		} else {
			cfg.Proxy.Profiles = normalized
		}
	}

	if legacyProfile.ProxyURL != "" || legacyProfile.ResinURL != "" || legacyProfile.ResinPlatformName != "" {
		legacyProfile = normalizeProxyProfile(legacyProfile)
		if cfg.Proxy.Profiles == nil {
			cfg.Proxy.Profiles = map[string]ProxyProfile{}
		}
		if _, exists := cfg.Proxy.Profiles[migratedDefaultProxyProfileName]; !exists {
			cfg.Proxy.Profiles[migratedDefaultProxyProfileName] = legacyProfile
			if cfg.Proxy.Default == "" {
				cfg.Proxy.Default = migratedDefaultProxyProfileName
			}
		}
	}

	if cfg.Proxy.Default == "" && len(cfg.Proxy.Profiles) > 0 {
		if _, ok := cfg.Proxy.Profiles[migratedDefaultProxyProfileName]; ok {
			cfg.Proxy.Default = migratedDefaultProxyProfileName
		}
	}
}

func normalizeProxyProfile(profile ProxyProfile) ProxyProfile {
	profile.ProxyURL = strings.TrimSpace(profile.ProxyURL)
	profile.ResinURL = strings.TrimSpace(profile.ResinURL)
	profile.ResinPlatformName = strings.TrimSpace(profile.ResinPlatformName)

	if strings.EqualFold(profile.ProxyURL, "direct") || strings.EqualFold(profile.ProxyURL, "none") {
		profile.ResinURL = ""
		profile.ResinPlatformName = ""
	}

	return profile
}

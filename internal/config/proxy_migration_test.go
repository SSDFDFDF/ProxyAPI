package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadConfigOptional_MigratesLegacyProxyFields(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	configYAML := []byte(`
proxy-url: " http://legacy-proxy.example.com:8080 "
resin-url: " http://legacy-resin.example.com/token "
resin-platform-name: " Legacy "
`)
	if err := os.WriteFile(configPath, configYAML, 0o600); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	cfg, err := LoadConfigOptional(configPath, false)
	if err != nil {
		t.Fatalf("LoadConfigOptional() error = %v", err)
	}

	if got := cfg.ProxyURL; got != "" {
		t.Fatalf("ProxyURL = %q, want empty", got)
	}
	if got := cfg.ResinURL; got != "" {
		t.Fatalf("ResinURL = %q, want empty", got)
	}
	if got := cfg.ResinPlatformName; got != "" {
		t.Fatalf("ResinPlatformName = %q, want empty", got)
	}
	if got := cfg.Proxy.Default; got != migratedDefaultProxyProfileName {
		t.Fatalf("Proxy.Default = %q, want %q", got, migratedDefaultProxyProfileName)
	}
	profile, ok := cfg.Proxy.Profiles[migratedDefaultProxyProfileName]
	if !ok {
		t.Fatalf("Proxy.Profiles[%q] missing", migratedDefaultProxyProfileName)
	}
	if got := profile.ProxyURL; got != "http://legacy-proxy.example.com:8080" {
		t.Fatalf("profile.ProxyURL = %q, want %q", got, "http://legacy-proxy.example.com:8080")
	}
	if got := profile.ResinURL; got != "http://legacy-resin.example.com/token" {
		t.Fatalf("profile.ResinURL = %q, want %q", got, "http://legacy-resin.example.com/token")
	}
	if got := profile.ResinPlatformName; got != "Legacy" {
		t.Fatalf("profile.ResinPlatformName = %q, want %q", got, "Legacy")
	}
}

func TestSaveConfigPreserveComments_RemovesLegacyProxyKeys(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	configYAML := []byte(`
proxy-url: http://legacy-proxy.example.com:8080
resin-url: http://legacy-resin.example.com/token
resin-platform-name: Legacy
`)
	if err := os.WriteFile(configPath, configYAML, 0o600); err != nil {
		t.Fatalf("failed to write config: %v", err)
	}

	cfg, err := LoadConfigOptional(configPath, false)
	if err != nil {
		t.Fatalf("LoadConfigOptional() error = %v", err)
	}
	if err := SaveConfigPreserveComments(configPath, cfg); err != nil {
		t.Fatalf("SaveConfigPreserveComments() error = %v", err)
	}

	saved, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("failed to read saved config: %v", err)
	}
	content := string(saved)

	if strings.Contains(content, "\nproxy-url:") || strings.HasPrefix(content, "proxy-url:") {
		t.Fatalf("saved config still contains top-level legacy proxy-url: %s", content)
	}
	if strings.Contains(content, "\nresin-url:") || strings.HasPrefix(content, "resin-url:") {
		t.Fatalf("saved config still contains top-level legacy resin-url: %s", content)
	}
	if strings.Contains(content, "\nresin-platform-name:") || strings.HasPrefix(content, "resin-platform-name:") {
		t.Fatalf("saved config still contains top-level legacy resin-platform-name: %s", content)
	}
	if !strings.Contains(content, "proxy:") {
		t.Fatalf("saved config missing proxy block: %s", content)
	}
	if !strings.Contains(content, "default: default") {
		t.Fatalf("saved config missing migrated default selector: %s", content)
	}
	if !strings.Contains(content, "profiles:") {
		t.Fatalf("saved config missing proxy profiles: %s", content)
	}
	if !strings.Contains(content, "http://legacy-proxy.example.com:8080") {
		t.Fatalf("saved config missing migrated proxy URL: %s", content)
	}
	if !strings.Contains(content, "http://legacy-resin.example.com/token") {
		t.Fatalf("saved config missing migrated resin URL: %s", content)
	}
	if !strings.Contains(content, "Legacy") {
		t.Fatalf("saved config missing migrated resin platform: %s", content)
	}
}

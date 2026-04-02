package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

type resinTestAuthenticator struct {
	lastCfg *config.Config
	record  *coreauth.Auth
}

func (a *resinTestAuthenticator) Provider() string { return "codex" }

func (a *resinTestAuthenticator) Login(_ context.Context, cfg *config.Config, _ *LoginOptions) (*coreauth.Auth, error) {
	a.lastCfg = cfg
	if a.record == nil {
		a.record = &coreauth.Auth{
			ID:       "codex-user@example.com.json",
			Provider: "codex",
			Metadata: map[string]any{
				"email": "user@example.com",
			},
		}
	}
	return a.record.Clone(), nil
}

func (a *resinTestAuthenticator) RefreshLead() *time.Duration { return nil }

func TestManagerLoginResinTempIdentityPromotion(t *testing.T) {
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
			ResinURL:          server.URL + "/token",
			ResinPlatformName: "Default",
		},
	}

	authenticator := &resinTestAuthenticator{}
	manager := NewManager(nil, authenticator)

	record, _, err := manager.Login(context.Background(), "codex", cfg, &LoginOptions{Metadata: map[string]string{}})
	if err != nil {
		t.Fatalf("Manager.Login returned error: %v", err)
	}
	if authenticator.lastCfg == nil {
		t.Fatal("authenticator did not receive config")
	}

	parsedProxy, err := url.Parse(authenticator.lastCfg.ProxyURL)
	if err != nil {
		t.Fatalf("Parse(proxy-url) returned error: %v", err)
	}
	if got, want := parsedProxy.Host, strings.TrimPrefix(server.URL, "http://"); got != want {
		t.Fatalf("forward proxy host = %q, want %q", got, want)
	}
	username := parsedProxy.User.Username()
	if !strings.HasPrefix(username, "Default.codex:temp:") {
		t.Fatalf("forward proxy username = %q, want Default.codex:temp:*", username)
	}
	if got, want := gotPath, "/token/api/v1/Default/actions/inherit-lease"; got != want {
		t.Fatalf("inherit path = %q, want %q", got, want)
	}
	if parent := gotBody["parent_account"]; !strings.HasPrefix(parent, "codex:temp:") {
		t.Fatalf("parent_account = %q, want codex:temp:*", parent)
	}
	if got, want := gotBody["new_account"], "codex:user@example.com"; got != want {
		t.Fatalf("new_account = %q, want %q", got, want)
	}
	if record == nil {
		t.Fatal("Manager.Login returned nil record")
	}
	if got, want := strings.TrimSpace(stringValue(record.Metadata["resin_account"])), "codex:user@example.com"; got != want {
		t.Fatalf("record resin_account = %q, want %q", got, want)
	}
}

func stringValue(v any) string {
	s, _ := v.(string)
	return s
}

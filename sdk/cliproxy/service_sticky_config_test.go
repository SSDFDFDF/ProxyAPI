package cliproxy

import (
	"reflect"
	"testing"

	internalconfig "github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

func TestServiceApplyStickyConfig_EnabledSetsStoreAndHeaders(t *testing.T) {
	service := &Service{
		coreManager: coreauth.NewManager(nil, nil, nil),
	}

	service.applyStickyConfig(&internalconfig.Config{
		Routing: internalconfig.RoutingConfig{
			StickySession: internalconfig.StickySessionConfig{
				Enabled:    true,
				TTL:        "2m",
				MaxEntries: 321,
				Headers:    []string{"x-session-id"},
			},
		},
	})

	if service.coreManager.StickyStore() == nil {
		t.Fatal("expected sticky store to be initialized")
	}
	if got := service.coreManager.StickyHeaders(); !reflect.DeepEqual(got, []string{"x-session-id"}) {
		t.Fatalf("expected sticky headers to be applied, got %v", got)
	}
	if service.lastStickyKey == "" {
		t.Fatal("expected sticky cache key to be recorded")
	}
}

func TestServiceApplyStickyConfig_DisabledClearsStoreAndHeaders(t *testing.T) {
	service := &Service{
		coreManager: coreauth.NewManager(nil, nil, nil),
	}

	service.applyStickyConfig(&internalconfig.Config{
		Routing: internalconfig.RoutingConfig{
			StickySession: internalconfig.StickySessionConfig{
				Enabled:    true,
				TTL:        "1m",
				MaxEntries: 123,
				Headers:    []string{"x-session-id"},
			},
		},
	})

	service.applyStickyConfig(&internalconfig.Config{
		Routing: internalconfig.RoutingConfig{
			StickySession: internalconfig.StickySessionConfig{
				Enabled: false,
			},
		},
	})

	if service.coreManager.StickyStore() != nil {
		t.Fatal("expected sticky store to be cleared when sticky routing is disabled")
	}
	if got := service.coreManager.StickyHeaders(); len(got) != 0 {
		t.Fatalf("expected sticky headers to be cleared when sticky routing is disabled, got %v", got)
	}
	if service.lastStickyKey != "" {
		t.Fatalf("expected sticky cache key to be cleared, got %q", service.lastStickyKey)
	}
}

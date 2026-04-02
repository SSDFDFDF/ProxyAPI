package auth

import (
	"context"
	"net/http"
	"testing"
	"time"

	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/executor"
)

// stickyTestExecutor is a minimal ProviderExecutor for sticky routing integration tests.
type stickyTestExecutor struct {
	provider string
}

func (e stickyTestExecutor) Identifier() string { return e.provider }
func (stickyTestExecutor) Execute(_ context.Context, _ *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}
func (stickyTestExecutor) ExecuteStream(_ context.Context, _ *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
	return nil, nil
}
func (stickyTestExecutor) Refresh(_ context.Context, auth *Auth) (*Auth, error) {
	return auth, nil
}
func (stickyTestExecutor) CountTokens(_ context.Context, _ *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, nil
}
func (stickyTestExecutor) HttpRequest(_ context.Context, _ *Auth, _ *http.Request) (*http.Response, error) {
	return nil, nil
}

// newStickyTestManager creates a Manager with a sticky store, registers auths and
// an executor for the given provider. It uses the legacy (selector-based) path so
// that no global model registry setup is needed.
func newStickyTestManager(t *testing.T, ttl time.Duration, provider string, auths ...*Auth) *Manager {
	t.Helper()
	selector := &RoundRobinSelector{}
	m := NewManager(nil, selector, nil)
	store := NewStickySessionStore(ttl, 1000)
	m.SetStickyStore(store)
	m.RegisterExecutor(stickyTestExecutor{provider: provider})
	for _, a := range auths {
		if _, err := m.Register(context.Background(), a); err != nil {
			t.Fatalf("register auth %s: %v", a.ID, err)
		}
	}
	return m
}

func TestStickyRouting_NoHeaderBehaviorUnchanged(t *testing.T) {
	t.Parallel()

	m := newStickyTestManager(t, time.Minute, "test",
		&Auth{ID: "a1", Provider: "test"},
		&Auth{ID: "a2", Provider: "test"},
	)

	// No sticky session hash in metadata: should pick normally.
	opts := cliproxyexecutor.Options{}
	auth1, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext error: %v", err)
	}
	if auth1 == nil {
		t.Fatal("expected non-nil auth")
	}

	// Second call should still work (round-robin; may or may not be the same auth).
	auth2, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext error: %v", err)
	}
	if auth2 == nil {
		t.Fatal("expected non-nil auth")
	}

	// Verify the sticky store is empty (no bindings created without a session hash).
	if m.StickyStore().Len() != 0 {
		t.Fatalf("expected empty sticky store, got %d entries", m.StickyStore().Len())
	}
}

func TestStickyRouting_SameSessionSameAuth(t *testing.T) {
	t.Parallel()

	m := newStickyTestManager(t, time.Minute, "test",
		&Auth{ID: "a1", Provider: "test"},
		&Auth{ID: "a2", Provider: "test"},
	)

	sessionHash := "sess-hash-abc"
	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{
			cliproxyexecutor.StickySessionHashMetadataKey: sessionHash,
		},
	}

	auth1, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #1 error: %v", err)
	}

	// Second call with the same session hash should return the same auth.
	auth2, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #2 error: %v", err)
	}

	if auth1.ID != auth2.ID {
		t.Fatalf("expected same auth for same session hash, got %q and %q", auth1.ID, auth2.ID)
	}
}

func TestStickyRouting_PinnedAuthTakesPriority(t *testing.T) {
	t.Parallel()

	m := newStickyTestManager(t, time.Minute, "test",
		&Auth{ID: "a1", Provider: "test"},
		&Auth{ID: "a2", Provider: "test"},
	)

	sessionHash := "sess-hash-pin"

	// First, establish a sticky binding to a1.
	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{
			cliproxyexecutor.StickySessionHashMetadataKey: sessionHash,
		},
	}
	auth1, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #1 error: %v", err)
	}
	boundID := auth1.ID

	// Determine the other auth ID.
	otherID := "a1"
	if boundID == "a1" {
		otherID = "a2"
	}

	// Now pass both sticky hash AND pinned auth pointing to the other auth.
	// Pinned should win.
	pinnedOpts := cliproxyexecutor.Options{
		Metadata: map[string]any{
			cliproxyexecutor.StickySessionHashMetadataKey: sessionHash,
			cliproxyexecutor.PinnedAuthMetadataKey:        otherID,
		},
	}
	auth2, _, err := m.pickNext(context.Background(), "test", "", pinnedOpts, nil)
	if err != nil {
		t.Fatalf("pickNext #2 error: %v", err)
	}
	if auth2.ID != otherID {
		t.Fatalf("expected pinned auth %q to win, got %q", otherID, auth2.ID)
	}
}

func TestStickyRouting_DisabledAuthClearsBinding(t *testing.T) {
	t.Parallel()

	m := newStickyTestManager(t, time.Minute, "test",
		&Auth{ID: "a1", Provider: "test"},
		&Auth{ID: "a2", Provider: "test"},
	)

	sessionHash := "sess-hash-disable"
	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{
			cliproxyexecutor.StickySessionHashMetadataKey: sessionHash,
		},
	}

	// Establish binding.
	auth1, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #1 error: %v", err)
	}
	boundID := auth1.ID

	// Disable the bound auth.
	m.mu.Lock()
	if a, ok := m.auths[boundID]; ok {
		a.Disabled = true
	}
	m.mu.Unlock()
	m.syncScheduler()

	// Next pick with same session hash should clear the binding and pick the other auth.
	auth2, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #2 error: %v", err)
	}
	if auth2.ID == boundID {
		t.Fatalf("expected different auth after disabling %q, got same", boundID)
	}

	// The old binding should be deleted.
	if storedID, ok := m.StickyStore().Get(sessionHash); ok && storedID == boundID {
		t.Fatalf("expected old binding to be cleared, but still found %q", storedID)
	}
}

func TestStickyRouting_StickyAuthInTriedSkipped(t *testing.T) {
	t.Parallel()

	m := newStickyTestManager(t, time.Minute, "test",
		&Auth{ID: "a1", Provider: "test"},
		&Auth{ID: "a2", Provider: "test"},
	)

	sessionHash := "sess-hash-tried"
	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{
			cliproxyexecutor.StickySessionHashMetadataKey: sessionHash,
		},
	}

	// Establish binding.
	auth1, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #1 error: %v", err)
	}
	boundID := auth1.ID

	// Now call with the bound auth in the tried set.
	tried := map[string]struct{}{boundID: {}}
	auth2, _, err := m.pickNext(context.Background(), "test", "", opts, tried)
	if err != nil {
		t.Fatalf("pickNext #2 error: %v", err)
	}
	if auth2.ID == boundID {
		t.Fatalf("expected different auth when sticky auth is in tried set, got same %q", boundID)
	}

	// The old binding should be deleted since sticky auth was skipped.
	if storedID, ok := m.StickyStore().Get(sessionHash); ok && storedID == boundID {
		t.Fatalf("expected old binding to be cleared after tried skip, but found %q", storedID)
	}
}

func TestStickyRouting_TTLExpiry(t *testing.T) {
	t.Parallel()

	// Use a very short TTL.
	m := newStickyTestManager(t, 5*time.Millisecond, "test",
		&Auth{ID: "a1", Provider: "test"},
		&Auth{ID: "a2", Provider: "test"},
	)

	sessionHash := "sess-hash-ttl"
	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{
			cliproxyexecutor.StickySessionHashMetadataKey: sessionHash,
		},
	}

	// Establish binding.
	auth1, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #1 error: %v", err)
	}

	// Wait for TTL to expire.
	time.Sleep(10 * time.Millisecond)

	// After TTL expiry, the store should not return the old binding.
	if _, ok := m.StickyStore().Get(sessionHash); ok {
		t.Fatal("expected sticky binding to be expired")
	}

	// A new pick should create a fresh binding (may or may not be the same auth
	// due to round-robin, but the binding should be re-established).
	auth2, _, err := m.pickNext(context.Background(), "test", "", opts, nil)
	if err != nil {
		t.Fatalf("pickNext #2 error: %v", err)
	}
	if auth2 == nil {
		t.Fatal("expected non-nil auth after TTL expiry")
	}

	// Verify a new binding was created.
	storedID, ok := m.StickyStore().Get(sessionHash)
	if !ok {
		t.Fatal("expected new sticky binding after TTL expiry")
	}
	if storedID != auth2.ID {
		t.Fatalf("stored binding %q does not match picked auth %q", storedID, auth2.ID)
	}
	_ = auth1 // suppress unused warning
}

func TestStickyRouting_MixedProvider(t *testing.T) {
	t.Parallel()

	selector := &RoundRobinSelector{}
	m := NewManager(nil, selector, nil)
	store := NewStickySessionStore(time.Minute, 1000)
	m.SetStickyStore(store)
	m.RegisterExecutor(stickyTestExecutor{provider: "prova"})
	m.RegisterExecutor(stickyTestExecutor{provider: "provb"})

	for _, a := range []*Auth{
		{ID: "a1", Provider: "prova"},
		{ID: "a2", Provider: "provb"},
	} {
		if _, err := m.Register(context.Background(), a); err != nil {
			t.Fatalf("register auth %s: %v", a.ID, err)
		}
	}

	sessionHash := "sess-hash-mixed"
	providers := []string{"prova", "provb"}
	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{
			cliproxyexecutor.StickySessionHashMetadataKey: sessionHash,
		},
	}

	// First call establishes a binding.
	auth1, _, prov1, err := m.pickNextMixed(context.Background(), providers, "", opts, nil)
	if err != nil {
		t.Fatalf("pickNextMixed #1 error: %v", err)
	}
	if auth1 == nil {
		t.Fatal("expected non-nil auth")
	}
	if prov1 == "" {
		t.Fatal("expected non-empty provider")
	}

	// Second call with same session hash should return the same auth.
	auth2, _, prov2, err := m.pickNextMixed(context.Background(), providers, "", opts, nil)
	if err != nil {
		t.Fatalf("pickNextMixed #2 error: %v", err)
	}
	if auth1.ID != auth2.ID {
		t.Fatalf("expected same auth for same session hash in mixed mode, got %q and %q", auth1.ID, auth2.ID)
	}
	if prov1 != prov2 {
		t.Fatalf("expected same provider for sticky mixed, got %q and %q", prov1, prov2)
	}
}

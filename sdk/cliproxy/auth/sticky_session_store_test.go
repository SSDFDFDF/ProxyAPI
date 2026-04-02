package auth

import (
	"net/http"
	"sync"
	"testing"
	"time"
)

func TestStickySessionStore_BasicGetSetDelete(t *testing.T) {
	s := NewStickySessionStore(time.Minute, 100)

	// Miss on empty store.
	if _, ok := s.Get("k1"); ok {
		t.Fatal("expected miss on empty store")
	}

	s.Set("k1", "auth-a")
	id, ok := s.Get("k1")
	if !ok || id != "auth-a" {
		t.Fatalf("expected auth-a, got %q ok=%v", id, ok)
	}

	s.Delete("k1")
	if _, ok := s.Get("k1"); ok {
		t.Fatal("expected miss after delete")
	}
}

func TestStickySessionStore_TTLExpiry(t *testing.T) {
	s := NewStickySessionStore(time.Millisecond, 100)
	s.Set("k1", "auth-a")

	time.Sleep(5 * time.Millisecond)

	if _, ok := s.Get("k1"); ok {
		t.Fatal("expected miss after TTL expiry")
	}

	// Expired entry should have been cleaned up.
	if s.Len() != 0 {
		t.Fatalf("expected 0 entries after expired Get, got %d", s.Len())
	}
}

func TestStickySessionStore_RefreshExtendsTTL(t *testing.T) {
	s := NewStickySessionStore(10*time.Millisecond, 100)
	s.Set("k1", "auth-a")

	time.Sleep(6 * time.Millisecond)
	s.Refresh("k1")

	time.Sleep(6 * time.Millisecond)
	// Should still be alive because Refresh extended the TTL.
	id, ok := s.Get("k1")
	if !ok || id != "auth-a" {
		t.Fatalf("expected hit after refresh, got %q ok=%v", id, ok)
	}
}

func TestStickySessionStore_MaxEntriesEviction(t *testing.T) {
	s := NewStickySessionStore(time.Minute, 3)

	s.Set("k1", "a1")
	time.Sleep(time.Millisecond)
	s.Set("k2", "a2")
	time.Sleep(time.Millisecond)
	s.Set("k3", "a3")

	// All three present.
	if s.Len() != 3 {
		t.Fatalf("expected 3, got %d", s.Len())
	}

	// Adding a 4th should evict k1 (oldest lastSeenAt).
	s.Set("k4", "a4")
	if s.Len() != 3 {
		t.Fatalf("expected 3 after eviction, got %d", s.Len())
	}
	if _, ok := s.Get("k1"); ok {
		t.Fatal("expected k1 to be evicted")
	}
	if _, ok := s.Get("k4"); !ok {
		t.Fatal("expected k4 to be present")
	}
}

func TestStickySessionStore_MaxEntriesSweepsExpiredFirst(t *testing.T) {
	s := NewStickySessionStore(time.Millisecond, 2)
	s.Set("k1", "a1")
	time.Sleep(5 * time.Millisecond)

	// k1 is now expired. Set k2 + k3 should succeed because k1 gets swept.
	s.Set("k2", "a2")
	s.Set("k3", "a3")

	if s.Len() != 2 {
		t.Fatalf("expected 2, got %d", s.Len())
	}
}

func TestStickySessionStore_ConcurrentAccess(t *testing.T) {
	s := NewStickySessionStore(time.Second, 1000)
	var wg sync.WaitGroup

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := "k" + string(rune('A'+n%26))
			s.Set(key, "auth")
			s.Get(key)
			s.Refresh(key)
			s.Len()
			s.Delete(key)
		}(i)
	}
	wg.Wait()
}

func TestExtractSessionInfo(t *testing.T) {
	h := http.Header{}
	h.Set("X-Session-Id", "sess-123")
	h.Set("X-Request-Id", "req-456")

	info := ExtractSessionInfo(h, []string{"X-Session-Id", "X-Request-Id"})
	if info == nil || info.ID != "sess-123" || info.Source != "X-Session-Id" {
		t.Fatalf("unexpected info: %+v", info)
	}

	// No match.
	info = ExtractSessionInfo(h, []string{"X-Missing"})
	if info != nil {
		t.Fatalf("expected nil, got %+v", info)
	}
}

func TestGenerateStickySessionHash(t *testing.T) {
	h1 := GenerateStickySessionHash("ns", "header", "abc")
	h2 := GenerateStickySessionHash("ns", "header", "abc")
	h3 := GenerateStickySessionHash("ns", "header", "def")

	if h1 != h2 {
		t.Fatal("same input should produce same hash")
	}
	if h1 == h3 {
		t.Fatal("different input should produce different hash")
	}
	if len(h1) != 16 {
		t.Fatalf("expected 16 char hash, got %d", len(h1))
	}
}

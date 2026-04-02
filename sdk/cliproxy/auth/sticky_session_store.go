package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"
)

// StickySessionStore is an in-memory store mapping sessionHash to authID with
// TTL-based expiry and bounded capacity. All methods are safe for concurrent use.
type StickySessionStore struct {
	mu         sync.RWMutex
	entries    map[string]stickyEntry
	ttl        time.Duration
	maxEntries int
	opCount    uint64
}

type stickyEntry struct {
	authID     string
	expiresAt  time.Time
	lastSeenAt time.Time
}

// NewStickySessionStore creates a store with the given TTL and capacity limit.
func NewStickySessionStore(ttl time.Duration, maxEntries int) *StickySessionStore {
	return &StickySessionStore{
		entries:    make(map[string]stickyEntry),
		ttl:        ttl,
		maxEntries: maxEntries,
	}
}

// Get returns the authID bound to sessionHash. Returns ("", false) if not found
// or expired. Expired entries are deleted on access. On hit, lastSeenAt is updated.
func (s *StickySessionStore) Get(sessionHash string) (string, bool) {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.entries[sessionHash]
	if !ok {
		return "", false
	}
	if now.After(e.expiresAt) {
		delete(s.entries, sessionHash)
		return "", false
	}
	e.lastSeenAt = now
	s.entries[sessionHash] = e
	return e.authID, true
}

// Set writes a session binding. If at capacity, expired entries are swept first;
// if still at capacity the entry with the oldest lastSeenAt is evicted.
func (s *StickySessionStore) Set(sessionHash string, authID string) {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	// If key already exists, just overwrite.
	if _, exists := s.entries[sessionHash]; exists {
		s.entries[sessionHash] = stickyEntry{
			authID:     authID,
			expiresAt:  now.Add(s.ttl),
			lastSeenAt: now,
		}
		return
	}

	if len(s.entries) >= s.maxEntries {
		// Sweep expired entries.
		for k, v := range s.entries {
			if now.After(v.expiresAt) {
				delete(s.entries, k)
			}
		}
	}

	if len(s.entries) >= s.maxEntries {
		// Evict oldest lastSeenAt.
		var oldestKey string
		var oldestTime time.Time
		first := true
		for k, v := range s.entries {
			if first || v.lastSeenAt.Before(oldestTime) {
				oldestKey = k
				oldestTime = v.lastSeenAt
				first = false
			}
		}
		if oldestKey != "" {
			delete(s.entries, oldestKey)
		}
	}

	s.entries[sessionHash] = stickyEntry{
		authID:     authID,
		expiresAt:  now.Add(s.ttl),
		lastSeenAt: now,
	}
}

// Refresh extends the expiresAt of an existing entry to now+ttl.
// No-op if the entry does not exist.
func (s *StickySessionStore) Refresh(sessionHash string) {
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.entries[sessionHash]
	if !ok {
		return
	}
	e.expiresAt = now.Add(s.ttl)
	e.lastSeenAt = now
	s.entries[sessionHash] = e
}

// Delete removes a binding.
func (s *StickySessionStore) Delete(sessionHash string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, sessionHash)
}

// Len returns the current number of entries (including potentially expired ones).
func (s *StickySessionStore) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.entries)
}

// SessionInfo describes a session identifier extracted from HTTP headers.
type SessionInfo struct {
	ID     string
	Source string // header name that provided the ID, e.g. "session_id"
}

// ExtractSessionInfo checks candidate header names in order and returns the
// first non-empty value found. Returns nil if no candidate matches.
func ExtractSessionInfo(headers http.Header, candidates []string) *SessionInfo {
	for _, c := range candidates {
		v := strings.TrimSpace(headers.Get(c))
		if v != "" {
			return &SessionInfo{ID: v, Source: c}
		}
	}
	return nil
}

// GenerateStickySessionHash produces a deterministic hash key for the sticky store.
// The input is namespace + ":" + source + ":" + trimmedSessionID hashed with SHA-256,
// truncated to 16 hex characters.
func GenerateStickySessionHash(namespace, source, sessionID string) string {
	raw := namespace + ":" + source + ":" + strings.TrimSpace(sessionID)
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:8])
}

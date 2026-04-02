package auth

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/resin"
	coreauth "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/auth"
)

// Manager aggregates authenticators and coordinates persistence via a token store.
type Manager struct {
	authenticators map[string]Authenticator
	store          coreauth.Store
}

// NewManager constructs a manager with the provided token store and authenticators.
// If store is nil, the caller must set it later using SetStore.
func NewManager(store coreauth.Store, authenticators ...Authenticator) *Manager {
	mgr := &Manager{
		authenticators: make(map[string]Authenticator),
		store:          store,
	}
	for i := range authenticators {
		mgr.Register(authenticators[i])
	}
	return mgr
}

// Register adds or replaces an authenticator keyed by its provider identifier.
func (m *Manager) Register(a Authenticator) {
	if a == nil {
		return
	}
	if m.authenticators == nil {
		m.authenticators = make(map[string]Authenticator)
	}
	m.authenticators[a.Provider()] = a
}

// SetStore updates the token store used for persistence.
func (m *Manager) SetStore(store coreauth.Store) {
	m.store = store
}

// Login executes the provider login flow and persists the resulting auth record.
func (m *Manager) Login(ctx context.Context, provider string, cfg *config.Config, opts *LoginOptions) (*coreauth.Auth, string, error) {
	auth, ok := m.authenticators[provider]
	if !ok {
		return nil, "", fmt.Errorf("cliproxy auth: authenticator %s not registered", provider)
	}

	loginIdentity := buildLoginResinIdentity(provider, opts)
	effectiveCfg, _, err := resin.CloneConfigWithForwardProxy(cfg, loginIdentity)
	if err != nil {
		return nil, "", err
	}

	record, err := auth.Login(ctx, effectiveCfg, opts)
	if err != nil {
		return nil, "", err
	}
	if record == nil {
		return nil, "", fmt.Errorf("cliproxy auth: authenticator %s returned nil record", provider)
	}
	if strings.TrimSpace(record.Provider) == "" {
		record.Provider = provider
	}

	stableAccount := resin.StableAccount(record.Provider, record.Attributes, record.Metadata, record.ID)
	if stableAccount != "" {
		if record.Metadata == nil {
			record.Metadata = make(map[string]any)
		}
		record.Metadata["resin_account"] = stableAccount
	}
	if err := resin.InheritLease(ctx, cfg, loginIdentity.TempAccount, stableAccount); err != nil {
		// InheritLease is best-effort — login itself already succeeded.
		log.Printf("cliproxy auth: resin inherit-lease warning: %v", err)
	}

	if m.store == nil {
		return record, "", nil
	}

	if cfg != nil {
		if dirSetter, ok := m.store.(interface{ SetBaseDir(string) }); ok {
			dirSetter.SetBaseDir(cfg.AuthDir)
		}
		if cfgSetter, ok := m.store.(interface{ SetRuntimeConfig(*config.Config) }); ok {
			cfgSetter.SetRuntimeConfig(cfg)
		}
	}

	savedPath, err := m.store.Save(ctx, record)
	if err != nil {
		return record, "", err
	}
	return record, savedPath, nil
}

func buildLoginResinIdentity(provider string, opts *LoginOptions) resin.Identity {
	identity := resin.Identity{
		Provider: provider,
		Mode:     resin.ModeForward,
	}
	if opts == nil || len(opts.Metadata) == 0 {
		identity.TempAccount = resin.NewTempAccount(provider)
		return identity
	}

	candidates := []string{
		strings.TrimSpace(opts.Metadata["resin_account"]),
		strings.TrimSpace(opts.Metadata["account_id"]),
		strings.TrimSpace(opts.Metadata["email"]),
		strings.TrimSpace(opts.Metadata["alias"]),
		strings.TrimSpace(opts.Metadata["username"]),
		strings.TrimSpace(opts.Metadata["user_name"]),
		strings.TrimSpace(opts.Metadata["phone"]),
		strings.TrimSpace(opts.Metadata["account"]),
		strings.TrimSpace(opts.Metadata["user_id"]),
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		identity.Account = resin.ScopeAccount(provider, candidate)
		return identity
	}

	identity.TempAccount = resin.NewTempAccount(provider)
	return identity
}

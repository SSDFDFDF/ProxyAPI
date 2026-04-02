package resin

import (
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/sdk/proxyutil"
)

// WrapRoundTripper applies Resin routing to a base RoundTripper for the provided identity.
// Runtime provider traffic uses this wrapper to keep reverse-proxy rewriting centralized.
func WrapRoundTripper(cfg *config.Config, base http.RoundTripper, identity Identity) (http.RoundTripper, error) {
	parsed, err := ParseConfig(cfg)
	if err != nil || parsed == nil {
		return base, err
	}

	account := parsed.EffectiveAccount(identity)
	if account == "" {
		return base, nil
	}

	if base == nil {
		if defaultTransport, ok := http.DefaultTransport.(*http.Transport); ok && defaultTransport != nil {
			base = defaultTransport.Clone()
		} else {
			base = &http.Transport{}
		}
	}

	return &roundTripper{
		base:        base,
		resinConfig: parsed,
		identity:    identity,
	}, nil
}

type roundTripper struct {
	base        http.RoundTripper
	resinConfig *ParsedConfig
	identity    Identity

	mu           sync.Mutex
	forwardCache map[string]http.RoundTripper
}

func (r *roundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil {
		return nil, fmt.Errorf("resin roundtripper: request is nil")
	}

	account := r.resinConfig.EffectiveAccount(r.identity)
	if account == "" {
		return r.base.RoundTrip(req)
	}

	mode := r.identity.Mode
	if mode == "" {
		mode = ModeReverse
	}

	switch mode {
	case ModeForward:
		forwardRT, err := r.forwardRoundTripper(account)
		if err != nil {
			return nil, err
		}
		return forwardRT.RoundTrip(req)
	case ModeReverse:
		rewrittenURL, err := r.resinConfig.ReverseURL(req.URL)
		if err != nil {
			return nil, err
		}
		clone := req.Clone(req.Context())
		clone.URL = rewrittenURL
		clone.Host = ""
		clone.Header = req.Header.Clone()
		clone.Header.Set(AccountHeader, account)
		return r.base.RoundTrip(clone)
	default:
		return r.base.RoundTrip(req)
	}
}

func (r *roundTripper) forwardRoundTripper(account string) (http.RoundTripper, error) {
	proxyURL, err := r.resinConfig.ForwardProxyURL(account)
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if r.forwardCache == nil {
		r.forwardCache = make(map[string]http.RoundTripper)
	}
	if rt := r.forwardCache[proxyURL]; rt != nil {
		return rt, nil
	}

	transport, _, err := proxyutil.BuildHTTPTransport(proxyURL)
	if err != nil {
		return nil, err
	}
	if transport == nil {
		return nil, fmt.Errorf("resin forward proxy transport unavailable for %s", strings.TrimSpace(proxyURL))
	}
	r.forwardCache[proxyURL] = transport
	return transport, nil
}

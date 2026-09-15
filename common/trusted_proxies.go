package common

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// Private proxy CIDRs cover Docker / Traefik / k8s overlay hops.
// Traefik on a compose network is typically 172.16.0.0/12 or 10.0.0.0/8.
var defaultPrivateProxies = []string{
	"127.0.0.0/8",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"::1/128",
	"fc00::/7",
}

// ParseTrustedProxies resolves TRUSTED_PROXIES:
//   - empty / "private": RFC1918 + loopback + IPv6 ULA (Docker/Traefik default)
//   - "none" / "off" / "-": trust no hop; ClientIP() is the TCP peer
//   - otherwise: comma-separated CIDR/IP list
func ParseTrustedProxies(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.EqualFold(raw, "private") {
		return append([]string(nil), defaultPrivateProxies...)
	}
	if strings.EqualFold(raw, "none") || strings.EqualFold(raw, "off") || raw == "-" {
		return nil
	}
	parts := strings.Split(raw, ",")
	proxies := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			proxies = append(proxies, p)
		}
	}
	if len(proxies) == 0 {
		return append([]string(nil), defaultPrivateProxies...)
	}
	return proxies
}

// ConfigureTrustedProxies restricts which hops may set X-Forwarded-For.
func ConfigureTrustedProxies(engine *gin.Engine) {
	proxies := ParseTrustedProxies(os.Getenv("TRUSTED_PROXIES"))
	if err := engine.SetTrustedProxies(proxies); err != nil {
		SysLog("SetTrustedProxies failed: " + err.Error())
		return
	}
	if proxies == nil {
		SysLog("trusted proxies: none (ClientIP is TCP peer)")
		return
	}
	SysLog("trusted proxies: " + strings.Join(proxies, ", "))
}

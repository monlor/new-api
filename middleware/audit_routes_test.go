package middleware

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
)

var (
	groupAssignRe  = regexp.MustCompile(`^(\w+)\s*:?=\s*(\w+)\.Group\("([^"]*)"\)`)
	groupUseAuthRe = regexp.MustCompile(`^(\w+)\.Use\(middleware\.(AdminAuth|RootAuth)\(\)`)
	writeRouteRe   = regexp.MustCompile(`^(\w+)\.(POST|PUT|PATCH|DELETE)\("([^"]*)"`)
	inlineAdminRe  = regexp.MustCompile(`middleware\.(AdminAuth|RootAuth)\(\)`)
)

func joinGinPaths(absolutePath, relativePath string) string {
	if relativePath == "" {
		return absolutePath
	}
	finalPath := path.Join(absolutePath, relativePath)
	if strings.HasSuffix(relativePath, "/") && !strings.HasSuffix(finalPath, "/") {
		return finalPath + "/"
	}
	return finalPath
}

func adminWriteRoutesFromAPIRouter(t *testing.T) []string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	src, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "router", "api-router.go"))
	if err != nil {
		t.Fatal(err)
	}

	type group struct {
		prefix string
		admin  bool
	}
	groups := map[string]group{
		"apiRouter": {prefix: "/api"},
	}
	var routes []string
	seen := map[string]bool{}

	for _, raw := range strings.Split(string(src), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		if m := groupAssignRe.FindStringSubmatch(line); m != nil {
			parent, ok := groups[m[2]]
			if !ok {
				continue
			}
			groups[m[1]] = group{
				prefix: joinGinPaths(parent.prefix, m[3]),
				admin:  parent.admin,
			}
			continue
		}
		if m := groupUseAuthRe.FindStringSubmatch(line); m != nil {
			g := groups[m[1]]
			g.admin = true
			groups[m[1]] = g
			continue
		}
		m := writeRouteRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		g, ok := groups[m[1]]
		if !ok {
			continue
		}
		admin := g.admin || inlineAdminRe.MatchString(line)
		if !admin {
			continue
		}
		key := m[2] + " " + joinGinPaths(g.prefix, m[3])
		if seen[key] {
			continue
		}
		seen[key] = true
		routes = append(routes, key)
	}
	if len(routes) == 0 {
		t.Fatal("parsed zero admin/root write routes from router/api-router.go")
	}
	return routes
}

func TestAdminWriteRoutesHaveAuditActionsOrSkip(t *testing.T) {
	var missing []string
	for _, route := range adminWriteRoutesFromAPIRouter(t) {
		if auditSkipRoutes[route] {
			continue
		}
		if _, ok := auditRouteActions[route]; ok {
			continue
		}
		missing = append(missing, route)
	}
	if len(missing) > 0 {
		t.Fatalf("admin/root write routes missing audit mapping or skip:\n  %s", strings.Join(missing, "\n  "))
	}
}

func TestAuditSkipRoutesAreNotMapped(t *testing.T) {
	for route := range auditSkipRoutes {
		if action, ok := auditRouteActions[route]; ok {
			t.Errorf("%s is both skipped and mapped to %q", route, action)
		}
	}
}

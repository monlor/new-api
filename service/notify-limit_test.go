package service

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

// 这些测试均针对内存限流路径（Redis 关闭）。
func withMemoryLimiter(t *testing.T, count, durationMinute int) {
	t.Helper()
	common.RedisEnabled = false
	constant.NotifyLimitCount = count
	constant.NotificationLimitDurationMinute = durationMinute
}

// 串行场景：同一 user/type 在一个窗口内，恰好放行 NotifyLimitCount 次，其余被拦截。
func TestCheckNotificationLimit_SerialAllowsExactlyLimit(t *testing.T) {
	cases := []struct {
		name   string
		limit  int
		tries  int
		expect int // 期望放行次数
	}{
		{name: "limit 1 allows once", limit: 1, tries: 5, expect: 1},
		{name: "limit 2 allows twice", limit: 2, tries: 5, expect: 2},
		{name: "limit 3 allows thrice", limit: 3, tries: 4, expect: 3},
	}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withMemoryLimiter(t, tc.limit, 60)
			userId := 100000 + i // 每个子测试用独立 userId，避免共享全局 store 串扰
			allowed := 0
			for j := 0; j < tc.tries; j++ {
				ok, err := CheckNotificationLimit(userId, "quota_exceed")
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if ok {
					allowed++
				}
			}
			if allowed != tc.expect {
				t.Fatalf("allowed = %d, want %d", allowed, tc.expect)
			}
		})
	}
}

// 并发场景：limit=1 时，N 个并发 goroutine 中只能有 1 个放行（原子性保证不漏发第二封）。
func TestCheckNotificationLimit_ConcurrentRespectsLimit(t *testing.T) {
	withMemoryLimiter(t, 1, 60)
	const userId = 200001
	const goroutines = 50

	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0

	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			ok, err := CheckNotificationLimit(userId, "quota_exceed")
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if ok {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if allowed != 1 {
		t.Fatalf("concurrent allowed = %d, want 1", allowed)
	}
}

// 不同用户/类型互不影响，各自享有独立配额。
func TestCheckNotificationLimit_IsolatedPerUserAndType(t *testing.T) {
	withMemoryLimiter(t, 1, 60)

	ok, _ := CheckNotificationLimit(300001, "quota_exceed")
	if !ok {
		t.Fatal("first notify for user A should be allowed")
	}
	// 同用户、不同类型 → 独立计数，应放行
	if ok, _ := CheckNotificationLimit(300001, "other_type"); !ok {
		t.Fatal("different type should have its own quota")
	}
	// 不同用户、同类型 → 独立计数，应放行
	if ok, _ := CheckNotificationLimit(300002, "quota_exceed"); !ok {
		t.Fatal("different user should have its own quota")
	}
	// 同用户、同类型再次 → 已达上限，应拦截
	if ok, _ := CheckNotificationLimit(300001, "quota_exceed"); ok {
		t.Fatal("second notify for user A should be blocked")
	}
}

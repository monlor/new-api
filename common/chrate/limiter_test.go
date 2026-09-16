package chrate

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestAllowMemoryWindow(t *testing.T) {
	ResetMemoryForTest()
	ctx := context.Background()
	id := 9001

	ok, _, err := Allow(ctx, id, 2, 1000)
	if err != nil || !ok {
		t.Fatalf("first allow: ok=%v err=%v", ok, err)
	}
	ok, _, err = Allow(ctx, id, 2, 1000)
	if err != nil || !ok {
		t.Fatalf("second allow: ok=%v err=%v", ok, err)
	}
	ok, retry, err := Allow(ctx, id, 2, 1000)
	if err != nil {
		t.Fatalf("third allow err: %v", err)
	}
	if ok {
		t.Fatal("third allow should wait")
	}
	if retry <= 0 {
		t.Fatalf("retryAfter=%v, want > 0", retry)
	}
	usage, err := Usage(ctx, id, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if usage != 2 {
		t.Fatalf("usage=%d, want 2", usage)
	}
}

func TestAllowZeroCountUnlimited(t *testing.T) {
	ResetMemoryForTest()
	ok, _, err := Allow(context.Background(), 1, 0, 1000)
	if err != nil || !ok {
		t.Fatalf("unlimited should pass: ok=%v err=%v", ok, err)
	}
}

func TestWaitAllowTimesOut(t *testing.T) {
	ResetMemoryForTest()
	ctx := context.Background()
	id := 9002
	if err := WaitAllow(ctx, id, 1, 5000, time.Millisecond); err != nil {
		t.Fatalf("first wait: %v", err)
	}
	err := WaitAllow(ctx, id, 1, 5000, 30*time.Millisecond)
	var limitErr *LimitError
	if !errors.As(err, &limitErr) {
		t.Fatalf("want LimitError, got %v", err)
	}
}

func TestWaitAllowUnblocksAfterWindow(t *testing.T) {
	ResetMemoryForTest()
	ctx := context.Background()
	id := 9003
	if err := WaitAllow(ctx, id, 1, 40, time.Second); err != nil {
		t.Fatalf("first: %v", err)
	}
	start := time.Now()
	if err := WaitAllow(ctx, id, 1, 40, 500*time.Millisecond); err != nil {
		t.Fatalf("second: %v", err)
	}
	if time.Since(start) < 20*time.Millisecond {
		t.Fatalf("expected to wait for window, elapsed=%v", time.Since(start))
	}
}

func TestWaitAllowFirstAttemptIgnoresWaitTimeout(t *testing.T) {
	ResetMemoryForTest()
	id := 9005
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			results <- WaitAllow(context.Background(), id, 1, 1000, time.Millisecond)
		}()
	}
	close(start)

	var ok, limited int
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			ok++
			continue
		}
		var limitErr *LimitError
		if !errors.As(err, &limitErr) {
			t.Fatalf("unexpected err: %v", err)
		}
		limited++
	}
	if ok != 1 || limited != 1 {
		t.Fatalf("ok=%d limited=%d, want 1/1", ok, limited)
	}
}

func TestWaitAllowFIFOOrder(t *testing.T) {
	ResetMemoryForTest()
	ctx := context.Background()
	id := 9006

	// occupy the single slot for long enough that every waiter below is
	// guaranteed to be queued (rather than racing the window's own expiry)
	// before the slot is released. Each queued waiter must then wait out up
	// to `waiters` sequential windows, so waitTimeout must cover that chain.
	const windowMs = 80
	if err := WaitAllow(ctx, id, 1, windowMs, time.Second); err != nil {
		t.Fatalf("occupy: %v", err)
	}

	const waiters = 5
	const waitTimeout = (waiters + 2) * windowMs * time.Millisecond
	order := make(chan int, waiters)
	var started sync.WaitGroup
	started.Add(waiters)
	for i := 0; i < waiters; i++ {
		i := i
		go func() {
			started.Done()
			// stagger arrival so queue order is deterministic; each waiter
			// enters WaitAllow (and thus the FIFO queue) strictly after the
			// previous one, and all of them well before windowMs elapses.
			time.Sleep(time.Duration(i) * 10 * time.Millisecond)
			if err := WaitAllow(ctx, id, 1, windowMs, waitTimeout); err != nil {
				t.Errorf("waiter %d: %v", i, err)
				return
			}
			order <- i
		}()
	}
	started.Wait()

	for i := 0; i < waiters; i++ {
		select {
		case got := <-order:
			if got != i {
				t.Fatalf("grant order = %d, want %d (queue not FIFO)", got, i)
			}
		case <-time.After(waitTimeout + time.Second):
			t.Fatalf("timed out waiting for waiter %d", i)
		}
	}
}

func TestWaitAllowCanceled(t *testing.T) {
	ResetMemoryForTest()
	id := 9004
	if err := WaitAllow(context.Background(), id, 1, 5000, time.Second); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := WaitAllow(ctx, id, 1, 5000, 0)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want canceled, got %v", err)
	}
}

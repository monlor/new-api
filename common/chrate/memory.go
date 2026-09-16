package chrate

import (
	"container/list"
	"sync"
	"time"
)

// Memory backend is per-process. Multi-replica deployments without Redis
// do not share this window and will under-enforce the configured limit.

type memEntry struct {
	ts int64
	id uint64
}

type memWindow struct {
	entries []memEntry
}

var (
	memMu      sync.Mutex
	memWindows = make(map[int]*memWindow)
)

func evalMemoryWindow(channelId int, nowMs int64, durationMs int, maxCount int, occupy bool) (windowResult, error) {
	windowStart := nowMs - int64(durationMs)

	memMu.Lock()
	defer memMu.Unlock()

	w := memWindows[channelId]
	if w == nil {
		w = &memWindow{}
		memWindows[channelId] = w
	}
	w.prune(windowStart)
	count := len(w.entries)
	if !occupy {
		return windowResult{count: count}, nil
	}
	if maxCount <= 0 || count < maxCount {
		w.entries = append(w.entries, memEntry{ts: nowMs, id: memberSeq.Add(1)})
		return windowResult{count: count + 1, allowed: true}, nil
	}
	retryAfter := time.Duration(w.entries[0].ts+int64(durationMs)-nowMs) * time.Millisecond
	if retryAfter < 0 {
		retryAfter = 0
	}
	return windowResult{count: count, retryAfter: retryAfter}, nil
}

func (w *memWindow) prune(windowStart int64) {
	i := 0
	for i < len(w.entries) && w.entries[i].ts <= windowStart {
		i++
	}
	if i == 0 {
		return
	}
	w.entries = append([]memEntry(nil), w.entries[i:]...)
}

func ResetMemoryForTest() {
	memMu.Lock()
	memWindows = make(map[int]*memWindow)
	memMu.Unlock()

	memQueueMu.Lock()
	memQueues = make(map[int]*list.List)
	memQueueMu.Unlock()
}

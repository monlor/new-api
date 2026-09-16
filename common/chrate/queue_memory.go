package chrate

import (
	"container/list"
	"sync"
)

// In-process FIFO ticket queue: waiters for the same channelId are granted
// the right to attempt a slot in arrival order. Only the queue head may call
// Allow(); it must call release() (success, timeout, or cancellation) so the
// next waiter can proceed.

var (
	memQueueMu sync.Mutex
	memQueues  = make(map[int]*list.List)
)

func acquireMemoryTurn(channelId int) (turn <-chan struct{}, release func()) {
	memQueueMu.Lock()
	q, ok := memQueues[channelId]
	if !ok {
		q = list.New()
		memQueues[channelId] = q
	}
	myTurn := make(chan struct{})
	elem := q.PushBack(myTurn)
	if q.Front() == elem {
		close(myTurn)
	}
	memQueueMu.Unlock()

	released := false
	release = func() {
		memQueueMu.Lock()
		defer memQueueMu.Unlock()
		if released {
			return
		}
		released = true
		for e := q.Front(); e != nil; e = e.Next() {
			if e.Value.(chan struct{}) == myTurn {
				q.Remove(e)
				break
			}
		}
		if front := q.Front(); front != nil {
			close(front.Value.(chan struct{}))
		}
		if q.Len() == 0 {
			delete(memQueues, channelId)
		}
	}
	return myTurn, release
}

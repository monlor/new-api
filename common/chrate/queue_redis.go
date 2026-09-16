package chrate

import (
	"context"
	_ "embed"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

//go:embed lua/queue_poll.lua
var queuePollScript string

const (
	queueKeyPrefix      = "chrl:q:"
	queueLeaseKeyPrefix = "chrl:qlease:"
	queuePollInterval   = 20 * time.Millisecond
	// queueLeaseTTL is refreshed on every poll tick, independent of the
	// caller's overall wait budget (which may be unbounded). It only needs
	// to comfortably outlive one poll interval so a crashed/abandoned
	// waiter is detected quickly without depending on how long the caller
	// intends to wait.
	queueLeaseTTL = 10 * queuePollInterval
)

var (
	queueScriptOnce sync.Once
	queueScriptSHA  string
)

func redisQueueKey(channelId int) string {
	return queueKeyPrefix + strconv.Itoa(channelId)
}

func redisQueueLeasePrefix(channelId int) string {
	return queueLeaseKeyPrefix + strconv.Itoa(channelId) + ":"
}

func loadQueuePollScript() {
	queueScriptOnce.Do(func() {
		if !common.RedisEnabled || common.RDB == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), scriptLoadTimeout)
		defer cancel()
		sha, err := common.RDB.ScriptLoad(ctx, queuePollScript).Result()
		if err != nil {
			common.SysLog(fmt.Sprintf("Failed to load channel rate limit queue script: %v", err))
			return
		}
		queueScriptSHA = sha
	})
}

func evalQueuePoll(ctx context.Context, channelId int, waiterId string) (myTurn bool, err error) {
	loadQueuePollScript()
	keys := []string{redisQueueKey(channelId)}
	args := []any{waiterId, redisQueueLeasePrefix(channelId)}

	var vals []any
	if queueScriptSHA != "" {
		vals, err = common.RDB.EvalSha(ctx, queueScriptSHA, keys, args...).Slice()
		if err != nil && isNoScript(err) {
			vals, err = common.RDB.Eval(ctx, queuePollScript, keys, args...).Slice()
		}
	} else {
		vals, err = common.RDB.Eval(ctx, queuePollScript, keys, args...).Slice()
	}
	if err != nil {
		return false, err
	}
	if len(vals) < 1 {
		return false, fmt.Errorf("unexpected queue poll result")
	}
	turn, err := toInt(vals[0])
	if err != nil {
		return false, err
	}
	return turn == 1, nil
}

// acquireRedisTurn blocks until it is the caller's turn in the cross-instance
// FIFO queue for channelId or ctx is done. release must always be called to
// remove the waiter from the queue.
func acquireRedisTurn(ctx context.Context, channelId int) (release func(), err error) {
	waiterId := strconv.FormatInt(time.Now().UnixMilli(), 10) + "-" + strconv.FormatUint(memberSeq.Add(1), 10)
	leaseKey := redisQueueLeasePrefix(channelId) + waiterId
	queueKey := redisQueueKey(channelId)

	if err := common.RDB.RPush(ctx, queueKey, waiterId).Err(); err != nil {
		return func() {}, err
	}
	if err := common.RDB.Set(ctx, leaseKey, "1", queueLeaseTTL).Err(); err != nil {
		common.RDB.LRem(context.Background(), queueKey, 1, waiterId)
		return func() {}, err
	}

	release = func() {
		relCtx, cancel := context.WithTimeout(context.Background(), scriptLoadTimeout)
		defer cancel()
		common.RDB.LRem(relCtx, queueKey, 1, waiterId)
		common.RDB.Del(relCtx, leaseKey)
	}

	for {
		myTurn, pollErr := evalQueuePoll(ctx, channelId, waiterId)
		if pollErr != nil {
			release()
			return func() {}, pollErr
		}
		if myTurn {
			return release, nil
		}
		if err := sleepCtx(ctx, queuePollInterval); err != nil {
			release()
			return func() {}, err
		}
		// Refresh the lease so this waiter isn't mistaken for a crashed
		// one, regardless of how long the caller's overall wait budget is.
		common.RDB.Expire(ctx, leaseKey, queueLeaseTTL)
	}
}

package chrate

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

//go:embed lua/sliding_window.lua
var slidingWindowScript string

const (
	keyPrefix         = "chrl:"
	defaultDurationMs = 1000
	minSleep          = 10 * time.Millisecond
	maxJitter         = 40 * time.Millisecond
	scriptLoadTimeout = 5 * time.Second
)

var (
	memberSeq atomic.Uint64

	redisOnce      sync.Once
	redisScriptSHA string
)

// LimitError is returned when the wait budget is exhausted.
type LimitError struct {
	RetryAfter time.Duration
}

func (e *LimitError) Error() string {
	if e == nil {
		return "channel rate limited"
	}
	return "channel rate limited"
}

func (e *LimitError) Is(target error) bool {
	_, ok := target.(*LimitError)
	return ok
}

type windowResult struct {
	count      int
	allowed    bool
	retryAfter time.Duration
}

func redisKey(channelId int) string {
	return keyPrefix + strconv.Itoa(channelId)
}

func normalizeDurationMs(durationMs int) int {
	if durationMs <= 0 {
		return defaultDurationMs
	}
	return durationMs
}

func ttlMs(durationMs int) int {
	ttl := durationMs * 2
	if ttl < 2000 {
		return 2000
	}
	return ttl
}

func loadRedisScript() {
	redisOnce.Do(func() {
		if !common.RedisEnabled || common.RDB == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), scriptLoadTimeout)
		defer cancel()
		sha, err := common.RDB.ScriptLoad(ctx, slidingWindowScript).Result()
		if err != nil {
			common.SysLog(fmt.Sprintf("Failed to load channel rate limit script: %v", err))
			return
		}
		redisScriptSHA = sha
	})
}

func evalWindow(ctx context.Context, channelId int, count int, durationMs int, occupy bool) (windowResult, error) {
	durationMs = normalizeDurationMs(durationMs)
	nowMs := time.Now().UnixMilli()
	occupyFlag := 0
	if occupy {
		occupyFlag = 1
	}
	member := strconv.FormatInt(nowMs, 10) + "-" + strconv.FormatUint(memberSeq.Add(1), 10)

	if common.RedisEnabled && common.RDB != nil {
		return evalRedisWindow(ctx, channelId, nowMs, durationMs, count, member, occupyFlag)
	}
	return evalMemoryWindow(channelId, nowMs, durationMs, count, occupy)
}

func evalRedisWindow(ctx context.Context, channelId int, nowMs int64, durationMs int, maxCount int, member string, occupyFlag int) (windowResult, error) {
	loadRedisScript()
	args := []any{nowMs, durationMs, maxCount, ttlMs(durationMs), member, occupyFlag}
	keys := []string{redisKey(channelId)}

	vals, err := evalRedis(ctx, keys, args)
	if err != nil {
		return windowResult{}, err
	}
	return parseWindowSlice(vals)
}

func evalRedis(ctx context.Context, keys []string, args []any) ([]any, error) {
	if redisScriptSHA != "" {
		vals, err := common.RDB.EvalSha(ctx, redisScriptSHA, keys, args...).Slice()
		if err == nil {
			return vals, nil
		}
		if !isNoScript(err) {
			return nil, err
		}
	}
	return common.RDB.Eval(ctx, slidingWindowScript, keys, args...).Slice()
}

func isNoScript(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, redis.Nil) {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "NOSCRIPT")
}

func parseWindowSlice(vals []any) (windowResult, error) {
	if len(vals) < 3 {
		return windowResult{}, fmt.Errorf("unexpected channel rate limit result")
	}
	count, err := toInt(vals[0])
	if err != nil {
		return windowResult{}, err
	}
	allowedN, err := toInt(vals[1])
	if err != nil {
		return windowResult{}, err
	}
	retryMs, err := toInt(vals[2])
	if err != nil {
		return windowResult{}, err
	}
	retryAfter := time.Duration(retryMs) * time.Millisecond
	if retryAfter < 0 {
		retryAfter = 0
	}
	return windowResult{
		count:      count,
		allowed:    allowedN == 1,
		retryAfter: retryAfter,
	}, nil
}

func toInt(v any) (int, error) {
	switch n := v.(type) {
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case float64:
		return int(n), nil
	case string:
		parsed, err := strconv.Atoi(n)
		if err != nil {
			return 0, err
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("unexpected redis number type %T", v)
	}
}

// Usage returns the current in-window count without occupying a slot.
func Usage(ctx context.Context, channelId int, durationMs int) (int, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	res, err := evalWindow(ctx, channelId, 0, durationMs, false)
	if err != nil {
		common.SysLog(fmt.Sprintf("channel rate limit usage failed, fail-open: %v", err))
		return 0, nil
	}
	return res.count, nil
}

// Allow occupies one slot when the window is under the limit.
func Allow(ctx context.Context, channelId int, count int, durationMs int) (bool, time.Duration, error) {
	if count <= 0 {
		return true, 0, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	res, err := evalWindow(ctx, channelId, count, durationMs, true)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return false, 0, err
		}
		common.SysLog(fmt.Sprintf("channel rate limit allow failed, fail-open: %v", err))
		return true, 0, nil
	}
	return res.allowed, res.retryAfter, nil
}

// WaitAllow tries to take a slot immediately, then retries until a slot is taken,
// ctx is done, or waitTimeout elapses. The first attempt is not bound by waitTimeout.
// waitTimeout <= 0 waits until ctx is cancelled.
func WaitAllow(ctx context.Context, channelId int, count int, durationMs int, waitTimeout time.Duration) error {
	if count <= 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	allowed, retryAfter, err := Allow(ctx, channelId, count, durationMs)
	if err != nil {
		return err
	}
	if allowed {
		return nil
	}

	deadlineCtx := ctx
	cancel := func() {}
	if waitTimeout > 0 {
		deadlineCtx, cancel = context.WithTimeout(ctx, waitTimeout)
	}
	defer cancel()

	for {
		if err := sleepCtx(deadlineCtx, sleepForRetry(retryAfter)); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return &LimitError{RetryAfter: retryAfter}
			}
			return err
		}
		allowed, retryAfter, err = Allow(deadlineCtx, channelId, count, durationMs)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				if errors.Is(deadlineCtx.Err(), context.DeadlineExceeded) {
					return &LimitError{RetryAfter: retryAfter}
				}
				return deadlineCtx.Err()
			}
			return err
		}
		if allowed {
			return nil
		}
	}
}

func sleepForRetry(retryAfter time.Duration) time.Duration {
	sleepFor := retryAfter
	if sleepFor < minSleep {
		sleepFor = minSleep
	}
	return sleepFor + jitter()
}

func jitter() time.Duration {
	maxMs := int(maxJitter / time.Millisecond)
	if maxMs <= 0 {
		return 0
	}
	return time.Duration(common.GetRandomInt(maxMs)) * time.Millisecond
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

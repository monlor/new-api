package service

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const logCleanupTickInterval = 1 * time.Hour

var (
	logCleanupOnce    sync.Once
	logCleanupRunning atomic.Bool
)

func StartLogCleanupTask() {
	logCleanupOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("log cleanup task started: tick=%s", logCleanupTickInterval))
			ticker := time.NewTicker(logCleanupTickInterval)
			defer ticker.Stop()

			runLogCleanupOnce()
			for range ticker.C {
				runLogCleanupOnce()
			}
		})
	})
}

func TriggerLogCleanup() {
	gopool.Go(runLogCleanupOnce)
}

func runLogCleanupOnce() {
	if !logCleanupRunning.CompareAndSwap(false, true) {
		return
	}
	defer logCleanupRunning.Store(false)

	days := common.LogRetentionDays
	if days <= 0 {
		return
	}

	ctx := context.Background()
	logCount, reviewCount, err := model.CleanupExpiredLogs(ctx, days)
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("log cleanup task failed: %v", err))
		return
	}
	if logCount == 0 && reviewCount == 0 {
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf(
		"log cleanup: usage=%d review=%d retention_days=%d",
		logCount, reviewCount, days,
	))
}

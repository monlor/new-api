package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func testGroupRatios() map[string]float64 {
	return map[string]float64{
		"default": 1,
		"vip":     0.5,
		"svip":    0.2,
	}
}

func TestMinEffectiveRatio(t *testing.T) {
	groupRatios := testGroupRatios()

	// 无启用分组：回落到 1
	require.InDelta(t, 1.0, minEffectiveRatio(model.Pricing{}, groupRatios), 1e-9)

	// 单分组：group_ratio × channel_ratio_min
	single := model.Pricing{
		EnableGroup:          []string{"vip"},
		GroupChannelRatioMin: map[string]float64{"vip": 0.8},
	}
	require.InDelta(t, 0.4, minEffectiveRatio(single, groupRatios), 1e-9)

	// 多分组：取最小的 group_ratio × channel_ratio_min
	multi := model.Pricing{
		EnableGroup:          []string{"default", "vip", "svip"},
		GroupChannelRatioMin: map[string]float64{"default": 1, "vip": 0.8, "svip": 2},
	}
	// default=1, vip=0.4, svip=0.4 → 0.4
	require.InDelta(t, 0.4, minEffectiveRatio(multi, groupRatios), 1e-9)

	// 缺失 channel_ratio_min 条目时 channel ratio 视为 1
	noChannel := model.Pricing{EnableGroup: []string{"svip"}}
	require.InDelta(t, 0.2, minEffectiveRatio(noChannel, groupRatios), 1e-9)

	// 分组在 group_ratio 里没有条目 → 跳过；全部跳过则回落到 1
	unknown := model.Pricing{
		EnableGroup:          []string{"not-configured", "vip"},
		GroupChannelRatioMin: map[string]float64{"not-configured": 0.01, "vip": 1},
	}
	require.InDelta(t, 0.5, minEffectiveRatio(unknown, groupRatios), 1e-9)

	allUnknown := model.Pricing{EnableGroup: []string{"not-configured"}}
	require.InDelta(t, 1.0, minEffectiveRatio(allUnknown, groupRatios), 1e-9)

	// Subscription 版本优先于普通 channel_ratio_min
	subscription := model.Pricing{
		EnableGroup:                      []string{"vip"},
		GroupChannelRatioMin:             map[string]float64{"vip": 0.8},
		GroupChannelRatioMinSubscription: map[string]float64{"vip": 0.4},
	}
	require.InDelta(t, 0.2, minEffectiveRatio(subscription, groupRatios), 1e-9)
}

func TestOriginalValueUSDForModelQuota(t *testing.T) {
	groupRatios := testGroupRatios()
	quota := int64(common.QuotaPerUnit)

	pricingByModel := map[string]model.Pricing{
		"gpt-4": {
			ModelName:            "gpt-4",
			EnableGroup:          []string{"default", "vip"},
			GroupChannelRatioMin: map[string]float64{"default": 1, "vip": 0.8},
		},
		"claude-sub": {
			ModelName:                        "claude-sub",
			EnableGroup:                      []string{"vip"},
			GroupChannelRatioMin:             map[string]float64{"vip": 0.8},
			GroupChannelRatioMinSubscription: map[string]float64{"vip": 0.4},
		},
		"zero-ratio": {
			ModelName:            "zero-ratio",
			EnableGroup:          []string{"default"},
			GroupChannelRatioMin: map[string]float64{"default": 0},
		},
	}

	// 最小有效倍率 0.4 → 1 USD / 0.4 = 2.5
	value, ok := originalValueUSDForModelQuota("gpt-4", quota, pricingByModel, groupRatios)
	require.True(t, ok)
	require.InDelta(t, 2.5, value, 1e-9)

	// subscription 倍率优先：0.5 × 0.4 = 0.2 → 5
	value, ok = originalValueUSDForModelQuota("claude-sub", quota, pricingByModel, groupRatios)
	require.True(t, ok)
	require.InDelta(t, 5.0, value, 1e-9)

	// 倍率 <= 0 → 跳过
	value, ok = originalValueUSDForModelQuota("zero-ratio", quota, pricingByModel, groupRatios)
	require.False(t, ok)
	require.Zero(t, value)

	// 定价表里没有该模型 → 跳过
	value, ok = originalValueUSDForModelQuota("totally-unknown-model-xyz", quota, pricingByModel, groupRatios)
	require.False(t, ok)
	require.Zero(t, value)
}

func TestOriginalValueUSDAccumulateOmitAndPartial(t *testing.T) {
	groupRatios := testGroupRatios()
	quota := int64(common.QuotaPerUnit)
	pricingByModel := map[string]model.Pricing{
		"gpt-4": {
			ModelName:            "gpt-4",
			EnableGroup:          []string{"default", "vip"},
			GroupChannelRatioMin: map[string]float64{"default": 1, "vip": 0.8},
		},
		"zero-ratio": {
			ModelName:            "zero-ratio",
			EnableGroup:          []string{"default"},
			GroupChannelRatioMin: map[string]float64{"default": 0},
		},
	}

	// 查询成功但无一换算 → omit（nil），不把 0 当已计算
	var sum float64
	converted := false
	addOriginalValueUSD(&sum, &converted, "totally-unknown-model-xyz", quota, pricingByModel, groupRatios)
	addOriginalValueUSD(&sum, &converted, "zero-ratio", quota, pricingByModel, groupRatios)
	require.False(t, converted)
	require.Zero(t, sum)
	require.Nil(t, originalValueUSDPtr(sum, converted))

	// 部分换算：只累加成功行；converted 后即使合计为 0 也发指针
	sum = 0
	converted = false
	addOriginalValueUSD(&sum, &converted, "gpt-4", quota, pricingByModel, groupRatios)
	addOriginalValueUSD(&sum, &converted, "totally-unknown-model-xyz", quota, pricingByModel, groupRatios)
	require.True(t, converted)
	require.InDelta(t, 2.5, sum, 1e-9)
	ptr := originalValueUSDPtr(sum, converted)
	require.NotNil(t, ptr)
	require.InDelta(t, 2.5, *ptr, 1e-9)

	// 成功换算但 quota=0 → 指针 0，不是 omit
	sum = 0
	converted = false
	addOriginalValueUSD(&sum, &converted, "gpt-4", 0, pricingByModel, groupRatios)
	require.True(t, converted)
	ptr = originalValueUSDPtr(sum, converted)
	require.NotNil(t, ptr)
	require.Zero(t, *ptr)

	// 按 id 累加：只给实际换算过的 id 打标
	values := make(map[int]float64)
	flags := make(map[int]bool)
	for _, row := range []struct {
		id    int
		model string
		quota int64
	}{
		{1, "gpt-4", quota},
		{1, "unknown", quota},
		{2, "zero-ratio", quota},
		{3, "gpt-4", 0},
	} {
		s := values[row.id]
		ok := flags[row.id]
		addOriginalValueUSD(&s, &ok, row.model, row.quota, pricingByModel, groupRatios)
		values[row.id] = s
		flags[row.id] = ok
	}
	require.True(t, flags[1])
	require.InDelta(t, 2.5, values[1], 1e-9)
	require.False(t, flags[2])
	require.Nil(t, originalValueUSDPtr(values[2], flags[2]))
	require.True(t, flags[3])
	require.NotNil(t, originalValueUSDPtr(values[3], flags[3]))
	require.Zero(t, *originalValueUSDPtr(values[3], flags[3]))
}

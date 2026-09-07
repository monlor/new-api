package controller

import (
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type legacyEpayTopUp struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id" gorm:"index"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string  `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
	Status          string  `json:"status"`
}

func (legacyEpayTopUp) TableName() string { return "top_ups" }

func setupEpayDecimalTest(t *testing.T) (*gorm.DB, int) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	confirmPaymentComplianceForTest(t)
	oldDB, oldLogDB := model.DB, model.LOG_DB
	initModelListColumnNames(t)
	oldSQLite, oldMySQL, oldPG, oldRedis := common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL, common.RedisEnabled
	oldQuota, oldPrice, oldMin := common.QuotaPerUnit, operation_setting.Price, operation_setting.MinTopUp
	oldDisplay := operation_setting.GetGeneralSetting().QuotaDisplayType
	oldAddress, oldID, oldKey, oldMethods := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey, operation_setting.PayMethods
	oldDiscount := operation_setting.GetPaymentSetting().AmountDiscount
	oldGroupRatio := common.TopupGroupRatio2JSONString()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL, common.RedisEnabled = oldSQLite, oldMySQL, oldPG, oldRedis
		common.QuotaPerUnit, operation_setting.Price, operation_setting.MinTopUp = oldQuota, oldPrice, oldMin
		operation_setting.GetGeneralSetting().QuotaDisplayType = oldDisplay
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey, operation_setting.PayMethods = oldAddress, oldID, oldKey, oldMethods
		operation_setting.GetPaymentSetting().AmountDiscount = oldDiscount
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(oldGroupRatio))
	})
	common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL, common.RedisEnabled = true, false, false, false
	common.QuotaPerUnit, operation_setting.Price, operation_setting.MinTopUp = 500_000, 7, 1
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeCNY
	operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = "https://epay.example.test", "test-merchant", "test-secret"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay"}, {"type": "usdt"}}
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{}
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1,"vip":0.8}`))
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &legacyEpayTopUp{}))
	user := model.User{Username: "epay-decimal-test", Group: "default"}
	require.NoError(t, db.Create(&user).Error)
	return db, user.Id
}

func callEpayJSON(t *testing.T, handler gin.HandlerFunc, id int, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", id)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/pay", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	handler(ctx)
	return recorder
}

func createDecimalEpayOrder(t *testing.T, id int, amount float64, method string, expectedMoney string) *model.TopUp {
	t.Helper()
	body := fmt.Sprintf(`{"amount":%.17g,"payment_method":%q}`, amount, method)
	var quote struct {
		Message string `json:"message"`
		Data    string `json:"data"`
	}
	require.NoError(t, common.Unmarshal(callEpayJSON(t, RequestAmount, id, body).Body.Bytes(), &quote))
	require.Equal(t, "success", quote.Message, quote.Data)
	require.Equal(t, expectedMoney, quote.Data)
	var payment struct {
		Message string            `json:"message"`
		Data    map[string]string `json:"data"`
	}
	require.NoError(t, common.Unmarshal(callEpayJSON(t, RequestEpay, id, body).Body.Bytes(), &payment))
	require.Equal(t, "success", payment.Message)
	require.Equal(t, quote.Data, payment.Data["money"])
	order := model.GetTopUpByTradeNo(payment.Data["out_trade_no"])
	require.NotNil(t, order)
	require.Equal(t, expectedMoney, fmt.Sprintf("%.2f", order.Money))
	return order
}

func notifyDecimalEpayOrder(t *testing.T, order *model.TopUp) {
	t.Helper()
	params := epay.GenerateParams(map[string]string{
		"pid": operation_setting.EpayId, "type": order.PaymentMethod,
		"out_trade_no": order.TradeNo, "trade_no": "gateway-" + order.TradeNo,
		"trade_status": epay.StatusTradeSuccess, "money": fmt.Sprintf("%.2f", order.Money),
	}, operation_setting.EpayKey)
	values := url.Values{}
	for key, value := range params {
		values.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/user/epay/notify", strings.NewReader(values.Encode()))
	ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	EpayNotify(ctx)
	require.Equal(t, "success", recorder.Body.String())
}

func TestEpayFractionalAmountQuotePurchaseNotifyAndHistory(t *testing.T) {
	for _, method := range []string{"alipay", "usdt"} {
		t.Run(method, func(t *testing.T) {
			db, id := setupEpayDecimalTest(t)
			require.NoError(t, db.AutoMigrate(&model.TopUp{}))
			order := createDecimalEpayOrder(t, id, 90.0/7, method, "90.00")
			require.InDelta(t, 90.0/7, order.EpayAmount, 1e-12)
			require.Equal(t, int64(6_428_571), order.CreditedQuota)
			// The amount in every existing history response is fractional, even
			// though the legacy database amount column remains an integer.
			raw, err := common.Marshal(order)
			require.NoError(t, err)
			var history struct {
				Amount float64 `json:"amount"`
			}
			require.NoError(t, common.Unmarshal(raw, &history))
			require.InDelta(t, 90.0/7, history.Amount, 1e-12)
			var historyResponse struct {
				Success bool `json:"success"`
				Data    struct {
					Items []struct {
						Amount float64 `json:"amount"`
					} `json:"items"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(callEpayJSON(t, GetUserTopUps, id, "").Body.Bytes(), &historyResponse))
			require.True(t, historyResponse.Success)
			require.Len(t, historyResponse.Data.Items, 1)
			require.InDelta(t, 90.0/7, historyResponse.Data.Items[0].Amount, 1e-12)
			// Settlement must use its snapshot even if configuration changes.
			common.QuotaPerUnit = 1_000_000
			notifyDecimalEpayOrder(t, order)
			notifyDecimalEpayOrder(t, order)
			var user model.User
			require.NoError(t, db.First(&user, id).Error)
			require.Equal(t, int(order.CreditedQuota), user.Quota)
			require.Equal(t, common.TopUpStatusSuccess, model.GetTopUpByTradeNo(order.TradeNo).Status)
		})
	}
}

func TestEpayFractionalTokenAmountAndManualCompletion(t *testing.T) {
	db, id := setupEpayDecimalTest(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeTokens
	order := createDecimalEpayOrder(t, id, 750_000, "usdt", "10.50")
	require.Equal(t, 1.5, order.EpayAmount)
	require.Equal(t, int64(750_000), order.CreditedQuota)
	common.QuotaPerUnit = 1_000_000
	require.NoError(t, model.ManualCompleteTopUp(order.TradeNo, "127.0.0.1"))
	require.NoError(t, model.ManualCompleteTopUp(order.TradeNo, "127.0.0.1"))
	var user model.User
	require.NoError(t, db.First(&user, id).Error)
	require.Equal(t, 750_000, user.Quota)
}

func TestEpayAdditiveMigrationPreservesLegacyAndStripeOrders(t *testing.T) {
	db, id := setupEpayDecimalTest(t)
	for _, provider := range []string{model.PaymentProviderEpay, model.PaymentProviderStripe} {
		legacy := legacyEpayTopUp{UserId: id, Amount: 12, Money: 84, TradeNo: provider, PaymentMethod: "alipay", PaymentProvider: provider, Status: common.TopUpStatusPending}
		if provider == model.PaymentProviderStripe {
			legacy.Money = 10
		}
		require.NoError(t, db.Create(&legacy).Error)
	}
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	require.True(t, db.Migrator().HasColumn(&model.TopUp{}, "EpayAmount"))
	require.True(t, db.Migrator().HasColumn(&model.TopUp{}, "CreditedQuota"))
	for _, provider := range []string{model.PaymentProviderEpay, model.PaymentProviderStripe} {
		order := model.GetTopUpByTradeNo(provider)
		require.Equal(t, int64(12), order.Amount)
		require.Zero(t, order.EpayAmount)
		require.Zero(t, order.CreditedQuota)
		raw, err := common.Marshal(order)
		require.NoError(t, err)
		var history struct {
			Amount int64 `json:"amount"`
		}
		require.NoError(t, common.Unmarshal(raw, &history))
		require.Equal(t, int64(12), history.Amount)
		if provider == model.PaymentProviderEpay {
			notifyDecimalEpayOrder(t, order)
		} else {
			require.NoError(t, model.ManualCompleteTopUp(order.TradeNo, "127.0.0.1"))
		}
	}
	legacyManual := model.TopUp{UserId: id, Amount: 3, Money: 21, TradeNo: "legacy-manual", PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, Status: common.TopUpStatusPending}
	require.NoError(t, legacyManual.Insert())
	require.NoError(t, model.ManualCompleteTopUp(legacyManual.TradeNo, "127.0.0.1"))
	var user model.User
	require.NoError(t, db.First(&user, id).Error)
	require.Equal(t, 25*500_000, user.Quota)
}

func TestEpayDiscountRoundingAndValidation(t *testing.T) {
	db, id := setupEpayDecimalTest(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{12: 0.9}
	for _, tc := range []struct {
		name   string
		amount float64
		group  string
		money  float64
	}{
		{"fraction does not match preset", 90.0 / 7, "default", 90},
		{"exact preset applies", 12, "default", 75.6},
		{"group ratio applies", 90.0 / 7, "vip", 72},
		{"group and discount apply", 12, "vip", 60.48},
		{"gateway rounds half cent", 1.005, "default", 7.04},
	} {
		t.Run(tc.name, func(t *testing.T) {
			money, err := getPayMoney(tc.amount, tc.group)
			require.NoError(t, err)
			require.Equal(t, tc.money, money)
		})
	}
	for _, invalid := range []float64{0, -1, 0.9, math.NaN(), math.Inf(1), math.Inf(-1), math.MaxFloat64, float64(math.MaxInt64)} {
		_, _, err := normalizeEpayTopupAmount(invalid)
		require.Error(t, err, "invalid amount %v", invalid)
	}
	createDecimalEpayOrder(t, id, 1.005, "alipay", "7.04")
	operation_setting.Price = math.MaxFloat64
	_, err := getPayMoney(2, "default")
	require.Error(t, err)
}

func TestEpayMinimumCentUsesSameQuoteAndPurchaseRules(t *testing.T) {
	db, id := setupEpayDecimalTest(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	operation_setting.MinTopUp = 0
	operation_setting.Price = 1
	order := createDecimalEpayOrder(t, id, 0.01, "alipay", "0.01")
	require.Equal(t, int64(5_000), order.CreditedQuota)
	for _, handler := range []gin.HandlerFunc{RequestAmount, RequestEpay} {
		response := callEpayJSON(t, handler, id, `{"amount":0.001,"payment_method":"alipay"}`)
		require.Contains(t, response.Body.String(), `"message":"error"`)
	}
}

func TestStripeEndpointsContinueToRejectFractionalQuantities(t *testing.T) {
	for _, handler := range []gin.HandlerFunc{RequestStripeAmount, RequestStripePay} {
		response := callEpayJSON(t, handler, 0, `{"amount":12.857142857142858,"payment_method":"stripe"}`)
		require.Contains(t, response.Body.String(), `"message":"error"`)
		require.Contains(t, response.Body.String(), "参数错误")
	}
}

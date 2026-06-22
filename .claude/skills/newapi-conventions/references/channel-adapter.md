# Provider 适配器开发速查（relay/channel/）

new-api 聚合 40+ 上游 AI 厂商。每家是 `relay/channel/<provider>/` 下的一个适配器。

## 目录
1. 适配器结构
2. Adaptor 接口（chat/embedding/image/audio/rerank/responses…）
3. TaskAdaptor 接口（异步任务类，含计费钩子）
4. 注册与接线
5. StreamOptions（Rule 4）
6. 自检清单

## 1. 适配器结构
典型一个 provider 目录：
```
relay/channel/<provider>/
├── adaptor.go    # 实现 Adaptor / TaskAdaptor 接口
└── constants.go  # 模型列表、channel 名、默认 base url 等
```
参考最简实现：`relay/channel/deepseek/`。复杂多模态参考 `openai/`、`gemini/`、`claude/`、`aws/`。

## 2. Adaptor 接口（`relay/channel/adapter.go`）
同步类（chat/embeddings/images/audio/rerank/responses）实现：
```go
Init(info *relaycommon.RelayInfo)
GetRequestURL(info) (string, error)
SetupRequestHeader(c, req *http.Header, info) error
ConvertOpenAIRequest(c, info, request *dto.GeneralOpenAIRequest) (any, error)
ConvertRerankRequest / ConvertEmbeddingRequest / ConvertAudioRequest /
ConvertImageRequest / ConvertOpenAIResponsesRequest / ConvertClaudeRequest / ConvertGeminiRequest
DoRequest(c, info, requestBody io.Reader) (any, error)
DoResponse(c, resp *http.Response, info) (usage any, err *types.NewAPIError)
GetModelList() []string
GetChannelName() string
```
不支持的转换方法返回 `nil, errors.New("not implemented")` 之类即可，沿用同类适配器写法。

## 3. TaskAdaptor 接口（异步任务，如视频/图像生成）
除请求/响应/轮询外，含三个**计费钩子**——任何带费用的 task 适配器都要正确实现：
- `EstimateBilling` —— 预扣：从请求里取时长/分辨率等，返回 ratio 乘子（如 `{"seconds":5,"size":1.666}`），无则返回 nil。
- `AdjustBillingOnSubmit` —— 上游 submit 返回的实际参数与预估不同时，返回修正后的 ratios 以重算结算差额。
- `AdjustBillingOnComplete` —— 轮询到终态时返回实际 quota，触发补扣/退款；返回 0 表示不变。
另有 `BuildRequestURL/Header/Body`、`DoRequest`、`DoResponse`、`FetchTask`、`ParseTaskResult`。
视频类可另实现 `OpenAIVideoConverter.ConvertToOpenAIVideo`。

## 4. 注册与接线
新增 provider 后需在常量/工厂处接线（沿用既有 provider 的注册路径）：
- `constant/`（如 `channel.go`/`api_type.go`）登记 channel 类型/常量。
- 适配器工厂（按现有 provider 在 relay 层的注册方式照搬）返回你的 `Adaptor`。
- `constants.go` 里填模型列表、`GetChannelName()`、默认 base url。
用 code-navigator 搜一个相近 provider（如 `deepseek`/`moonshot`）的全部引用点，照着接线一遍最稳。

## 5. StreamOptions（Rule 4）
确认 provider 是否支持 `stream_options`（如 OpenAI 的 usage-in-stream）。支持就把该 channel 加入 `streamSupportedChannels`（用 `search_code`/grep 定位该集合）。

## 6. 请求 DTO 指针规则（Rule 6 提醒）
转换函数里构造的上游请求结构，可选标量字段用指针+`omitempty`，保证用户显式置 `0/false` 时仍下发上游。

## 7. 自检清单
- [ ] 实现了所需的全部 Convert*/Do* 方法（不支持的明确返回 error）？
- [ ] `GetModelList()`/`GetChannelName()`/base url 正确？
- [ ] 在 constant/工厂处完成注册接线？
- [ ] 支持 stream_options 的已加入 `streamSupportedChannels`？
- [ ] task 类适配器的三个计费钩子语义正确？
- [ ] JSON 走 `common.*`，可选标量用指针？
- [ ] `go build ./...` 通过？

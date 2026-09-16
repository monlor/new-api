-- Sliding window channel rate limiter
-- KEYS[1]: limiter key
-- ARGV[1]: now_ms
-- ARGV[2]: window_ms
-- ARGV[3]: max_count
-- ARGV[4]: ttl_ms
-- ARGV[5]: member id
-- ARGV[6]: occupy (1 = try to take a slot, 0 = read-only usage)

local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max_count = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local member = ARGV[5]
local occupy = tonumber(ARGV[6])

if window == nil or window <= 0 then
    window = 1000
end
if ttl == nil or ttl < window then
    ttl = window * 2
end

local window_start = now - window
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
local count = redis.call('ZCARD', key)

if occupy == 0 then
    return {count, 0, 0}
end

if max_count <= 0 or count < max_count then
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, ttl)
    return {count + 1, 1, 0}
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry_after = 0
if oldest[2] ~= nil then
    retry_after = tonumber(oldest[2]) + window - now
    if retry_after < 0 then
        retry_after = 0
    end
end
return {count, 0, retry_after}

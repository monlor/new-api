-- FIFO wait-queue poll for channel rate limiting.
-- KEYS[1]: queue list key
-- ARGV[1]: my waiter id
-- ARGV[2]: lease key prefix (lease key = prefix .. waiter id)
--
-- Peeks the queue head; evicts consecutive stale heads (whose lease key has
-- expired, meaning that waiter crashed or gave up without cleaning up)
-- until it finds a live head or reaches the caller.
-- Returns {1, 0} if it is the caller's turn, {0, 1} if someone else is
-- still holding a live turn, {0, 0} if the queue is unexpectedly empty.

local queueKey = KEYS[1]
local myId = ARGV[1]
local leasePrefix = ARGV[2]

while true do
    local head = redis.call('LINDEX', queueKey, 0)
    if head == false then
        return {0, 0}
    end
    if head == myId then
        return {1, 0}
    end
    if redis.call('EXISTS', leasePrefix .. head) == 1 then
        return {0, 1}
    end
    redis.call('LPOP', queueKey)
end

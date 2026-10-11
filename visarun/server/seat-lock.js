import crypto from "node:crypto";

const CLAIM_SEAT_LUA = `
local current = redis.call("GET", KEYS[1])
if current and current ~= ARGV[1] then
  return 0
end
if tonumber(ARGV[2]) > 0 then
  redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
else
  redis.call("SET", KEYS[1], ARGV[1])
end
return 1
`;

const RELEASE_SEAT_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function seatLockKey(route, date, seat) {
  const id = crypto
    .createHash("sha256")
    .update([route, date, seat].join("|"))
    .digest("hex");
  return `vizaran:seatlock:${id}`;
}

async function claimSeat(redis, route, date, seat, orderId, ttlMs = 0) {
  const result = await redis.eval(
    CLAIM_SEAT_LUA,
    [seatLockKey(route, date, seat)],
    [String(orderId), String(Math.max(0, Math.floor(ttlMs)))]
  );
  return Number(result) === 1;
}

async function releaseSeat(redis, route, date, seat, orderId) {
  const result = await redis.eval(
    RELEASE_SEAT_LUA,
    [seatLockKey(route, date, seat)],
    [String(orderId)]
  );
  return Number(result) === 1;
}

export { seatLockKey, claimSeat, releaseSeat };

#!/usr/bin/env node
// Converts IPv4 CIDR blocks to start/end addresses for Azure firewall rules.
// Usage: node scripts/cidr-to-range.mjs 74.220.48.0/24 74.220.56.0/24
const toInt = (ip) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const toIp = (n) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");

for (const cidr of process.argv.slice(2)) {
  const [ip, bits] = cidr.split("/");
  const size = 2 ** (32 - Number(bits));
  const start = Math.floor(toInt(ip) / size) * size;
  console.log(`${cidr} ${toIp(start)} ${toIp(start + size - 1)}`);
}

import assert from "node:assert/strict";
import { MsgStream } from "../../shared/net/net.ts";

// 空袭区 duration 曾因浮点误差略超协议上限（60.03 > 60）触发
// writeFloat 的 assert，导致 uncaughtException 炸服（process-exit-1）。
// 序列化必须容错：超范围 / 非有限值都被 clamp，绝不崩溃。
const stream = new MsgStream(new ArrayBuffer(64));
stream.stream.writeFloat(60.02977889283055, 0, 60, 8);
stream.stream.writeFloat(150, 0, 60, 8);
stream.stream.writeFloat(-5, 0, 60, 8);
stream.stream.writeFloat(Number.NaN, 0, 60, 8);
stream.stream.writeFloat(30, 0, 60, 8);

// 读取回来验证 clamp 后的值落在范围内且可往返。
const readStream = new MsgStream(stream.getBuffer().slice().buffer as ArrayBuffer);
readStream.stream.index = 0;
// 8-bit 量化有正常精度误差（<0.5）。
const read = (): number => readStream.stream.readFloat(0, 60, 8);
assert.ok(Math.abs(read() - 60) < 0.5, "60.03 must clamp to 60");
assert.ok(Math.abs(read() - 60) < 0.5, "150 must clamp to 60");
assert.ok(Math.abs(read() - 0) < 0.5, "-5 must clamp to 0");
assert.ok(Math.abs(read() - 0) < 0.5, "NaN must clamp to min");
assert.ok(Math.abs(read() - 30) < 0.5, "in-range value must round-trip");

console.log(
    "Net float clamp smoke test passed: out-of-range / NaN float fields are clamped without crashing the server.",
);

import { describe, it, expect, vi } from "vitest";
import { bodyDigest, canonicalString, NonceStore, sign } from "../signature";
import { handleToolCall, ToolRegistry } from "../webhook";
import { buildOfficeTools } from "../office-tools";

const SECRET = "platform-secret";
const NOW = 1_700_000_000_000;
const PATH = "/api/mettara/tools";

function call(body: unknown, registry: ToolRegistry, nonce = "n1") {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(NOW / 1000));
  const digest = bodyDigest(raw);
  const signature = sign(
    SECRET,
    canonicalString({ method: "POST", path: PATH, timestamp, nonce, digest }),
  );
  return handleToolCall(
    {
      method: "POST",
      path: PATH,
      body: raw,
      headers: {
        "x-mettara-signature": signature,
        "x-mettara-timestamp": timestamp,
        "x-mettara-nonce": nonce,
        "x-mettara-content-sha256": digest,
      },
    },
    { secret: SECRET, registry, nonces: new NonceStore(), now: NOW },
  );
}

describe("mettara tool calls", () => {
  it("runs a registered handler and wraps the result", async () => {
    const registry = new ToolRegistry().register("greet", (req) => ({
      message: `Hello, ${req.arguments.name}`,
    }));
    const out = await call({ name: "greet", arguments: { name: "Jane" } }, registry);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ status: "success", data: { message: "Hello, Jane" } });
  });

  it("passes identity through when Mettara sends it", async () => {
    const seen: string[] = [];
    const registry = new ToolRegistry().register("who", (req) => {
      seen.push(req.externalUserId ?? "", req.externalGroupId ?? "");
      return null;
    });
    await call(
      { name: "who", arguments: {}, external_user_id: "u_42", external_group_id: "org_7" },
      registry,
    );
    expect(seen).toEqual(["u_42", "org_7"]);
  });

  it("refuses an unsigned request without reaching the handler", async () => {
    const handler = vi.fn();
    const registry = new ToolRegistry().register("greet", handler);
    const out = await handleToolCall(
      { method: "POST", path: PATH, body: '{"name":"greet"}', headers: {} },
      { secret: SECRET, registry, nonces: new NonceStore(), now: NOW },
    );
    expect(out.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("reports an unknown tool as a bad request", async () => {
    const out = await call({ name: "nope", arguments: {} }, new ToolRegistry());
    expect(out.status).toBe(400);
    expect(out.body.error).toContain("nope");
  });

  it("turns a throwing handler into a 500 rather than a crash", async () => {
    const registry = new ToolRegistry().register("boom", () => {
      throw new Error("kaboom");
    });
    const out = await call({ name: "boom", arguments: {} }, registry);
    expect(out).toEqual({ status: 500, body: { status: "error", error: "kaboom" } });
  });
});

describe("office tools", () => {
  const deps = {
    listWorkers: (room: string) => [{ seatId: "s1", label: `Sam of ${room}` }],
    dispatch: vi.fn(async (seatId: string, task: string) => ({ result: `${seatId} did ${task}` })),
    defaultRoom: "local",
  };

  it("lists the roster of the default room", async () => {
    const out = await call({ name: "list_workers", arguments: {} }, buildOfficeTools(deps));
    expect(out.body.data).toEqual({ workers: [{ seatId: "s1", label: "Sam of local" }] });
  });

  it("honours an explicit room", async () => {
    const out = await call(
      { name: "list_workers", arguments: { room: "hq" } },
      buildOfficeTools(deps),
    );
    expect(out.body.data).toEqual({ workers: [{ seatId: "s1", label: "Sam of hq" }] });
  });

  it("dispatches a task to a seat", async () => {
    const out = await call(
      { name: "dispatch_task", arguments: { seatId: "s1", task: "file the invoice" } },
      buildOfficeTools(deps),
    );
    expect(out.body.data).toEqual({ result: "s1 did file the invoice" });
  });

  it("rejects a dispatch with no task", async () => {
    const out = await call(
      { name: "dispatch_task", arguments: { seatId: "s1" } },
      buildOfficeTools(deps),
    );
    expect(out.status).toBe(500);
    expect(out.body.error).toBe("task is required");
  });

  it("surfaces a refused dispatch as an error", async () => {
    const refusing = { ...deps, dispatch: async () => ({ result: "", error: "Budget spent" }) };
    const out = await call(
      { name: "dispatch_task", arguments: { seatId: "s1", task: "spend" } },
      buildOfficeTools(refusing),
    );
    expect(out.body.error).toBe("Budget spent");
  });
});

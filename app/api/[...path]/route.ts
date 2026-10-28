import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { getDB } from "../../../lib/db";
import {
  Actor,
  AppError,
  assert,
  currentMonth,
} from "../../../lib/domain/model";
import {
  actorFromToken,
  login,
  makeInvite,
  register,
  inviteList,
  revokeInvite,
} from "../../../lib/services/auth";
import { hash } from "../../../lib/services/common";
import { saveRecord, reviewRecord } from "../../../lib/services/records";
import {
  workspace,
  checkGroup,
  recordHistory,
  members,
  grant,
  team,
} from "../../../lib/services/workspace";
import {
  createExport,
  ExportRow,
  preflight,
} from "../../../lib/services/exports";
import { buildWorkbook } from "../../../lib/excel/workbook";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function handle(req: NextRequest) {
  try {
    const path = req.nextUrl.pathname.replace(/^\/api\//, "");
    const write = req.method === "POST";
    if (write) {
      const origin = req.headers.get("origin");
      assert(
        origin &&
          (origin === req.nextUrl.origin || origin === process.env.APP_URL),
        "请求来源无效",
        403,
      );
      assert(
        req.headers.get("content-type")?.startsWith("application/json"),
        "请求须为JSON",
        415,
      );
      assert(
        Number(req.headers.get("content-length") ?? 0) < 100000,
        "请求过大",
        413,
      );
    }
    const raw = write ? await req.text() : "";
    assert(raw.length <= 50000, "请求过大", 413);
    const body = write ? JSON.parse(raw) : {};
    assert(
      body && typeof body === "object" && !Array.isArray(body),
      "JSON须为对象",
    );
    if (write && path === "login") {
      const token = await login(body);
      const res = json({ ok: true });
      res.cookies.set("session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86400,
      });
      return res;
    }
    const actor = await actorFromToken(req.cookies.get("session")?.value);
    if (write && path === "register") return json(await register(body, actor));
    assert(actor, "请先登录", 401);
    const a: Actor = actor;
    const key = req.headers.get("idempotency-key") ?? "";
    const month = req.nextUrl.searchParams.get("month") ?? currentMonth();
    if (write) {
      if (path === "logout") {
        await getDB().query("DELETE FROM sessions WHERE token_hash=$1", [
          hash(req.cookies.get("session")!.value),
        ]);
        const res = json({ ok: true });
        res.cookies.delete("session");
        return res;
      }
      if (path === "records") return json(await saveRecord(a, body, key));
      if (path === "review") return json(await reviewRecord(a, body, key));
      if (path === "check") return json(await checkGroup(a, body, key));
      if (path === "invites")
        return json(
          await makeInvite(
            a,
            z.number().int().min(1).max(5).parse(body.group_id),
          ),
        );
      if (path === "invites/revoke")
        return json(await revokeInvite(a, z.string().parse(body.token_hash)));
      if (path === "grants") return json(await grant(a, body));
      if (path === "exports") {
        const b = z
          .object({
            month: z.string(),
            hash: z.string().length(64),
            partial: z.boolean(),
          })
          .parse(body);
        return json(await createExport(a, b.month, b.hash, b.partial, key));
      }
    } else {
      if (path === "workspace")
        return json(
          await workspace(
            a,
            month,
            req.nextUrl.searchParams.get("mode") ??
              (a.is_admin ? "admin" : "me"),
          ),
        );
      if (path === "history")
        return json(
          await recordHistory(
            a,
            z.string().uuid().parse(req.nextUrl.searchParams.get("id")),
          ),
        );
      if (path === "invites") return json(await inviteList(a));
      if (path === "team")
        return json(
          await team(
            a,
            z.coerce
              .number()
              .int()
              .min(1)
              .max(5)
              .parse(req.nextUrl.searchParams.get("group")),
          ),
        );
      if (path === "members") return json(await members(a));
      if (path === "preflight") return json(await preflight(a, month));
      if (/^exports\/[\w-]+\/download$/.test(path)) {
        assert(a.is_admin, "需要总负责人权限", 403);
        const id = z.string().uuid().parse(path.split("/")[1]);
        const e = (
          await getDB().query<ExportRow>("SELECT * FROM exports WHERE id=$1", [
            id,
          ])
        ).rows[0];
        assert(e, "版本不存在", 404);
        const file = await buildWorkbook(e.snapshot);
        return new NextResponse(new Uint8Array(file), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`工时与费用汇总_${e.month}_v${e.version}.xlsx`)}`,
            "Cache-Control": "private, no-store",
          },
        });
      }
    }
    return json({ error: "接口不存在" }, 404);
  } catch (e) {
    if (e instanceof AppError) return json({ error: e.message }, e.status);
    if (e instanceof ZodError)
      return json(
        {
          error: e.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("；"),
        },
        400,
      );
    if (e instanceof SyntaxError) return json({ error: "请求JSON不正确" }, 400);
    console.error("Request failed", e instanceof Error ? e.message : "unknown");
    return json({ error: "服务暂不可用，请重试或检查数据库配置" }, 500);
  }
}
export const GET = handle;
export const POST = handle;

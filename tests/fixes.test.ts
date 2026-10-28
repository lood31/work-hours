import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { wrapLite, setTestDB } from "../lib/db";
import { Actor, RecordRow } from "../lib/domain/model";
import { refreshActor, hash } from "../lib/services/common";
import { saveRecord, reviewRecord } from "../lib/services/records";
import {
  workspace,
  recordHistory,
  team,
  checkGroup,
} from "../lib/services/workspace";
import { preflight, createExport, ExportRow } from "../lib/services/exports";
const pg = new PGlite(),
  db = wrapLite(pg);
let s: Actor, l: Actor, a: Actor;
const month = "2097-01";
beforeAll(async () => {
  for (const sql of (await readFile("migrations/001_initial.sql", "utf8"))
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean))
    await db.query(sql);
  setTestDB(db);
  for (const name of ["student", "lead", "admin"]) {
    const id = randomUUID();
    await db.query(
      "INSERT INTO users(id,login,name,student_no,password_hash,is_admin) VALUES($1,$2,$2,$2,$3,$4)",
      [id, name, "unused", name === "admin"],
    );
    await db.query(
      "INSERT INTO memberships(user_id,group_id,is_reviewer) VALUES($1,1,$2)",
      [id, name === "lead"],
    );
    const user = await refreshActor(db, id);
    if (name === "student") s = user;
    else if (name === "lead") l = user;
    else a = user;
  }
});
afterAll(() => pg.close());
const payload = (r?: RecordRow, submit = false) => ({
  month,
  group_id: 1,
  id: r?.id,
  revision: r?.revision,
  content: "private-draft-marker",
  hours: "",
  remark: "private-note-marker",
  submit,
});
it("草稿只归本人：列表/历史/预检/导出快照及直接写接口不泄露", async () => {
  const draft = await saveRecord(s, payload(), randomUUID());
  expect(JSON.stringify(await workspace(s, month, "me"))).toContain(
    "private-draft-marker",
  );
  for (const who of [l, a]) {
    const w = await workspace(who, month, who.is_admin ? "admin" : "review");
    expect(JSON.stringify(w)).not.toContain("private-draft-marker");
    expect(w.records).toHaveLength(0);
    await expect(recordHistory(who, draft.id)).rejects.toThrow();
    await expect(
      saveRecord(who, { ...payload(draft), hours: "1" }, randomUUID()),
    ).rejects.toThrow();
    await expect(
      reviewRecord(
        who,
        {
          id: draft.id,
          month,
          revision: draft.revision,
          action: "void",
          reason: "越权",
        },
        randomUUID(),
      ),
    ).rejects.toThrow();
  }
  await expect(
    checkGroup(l, { month, group_id: 1, confirmExcluded: false }, randomUUID()),
  ).rejects.toThrow("草稿");
  const p = await preflight(a, month);
  expect(JSON.stringify(p)).not.toContain("private-draft-marker");
  expect(p.excluded).toHaveLength(0);
  await expect(
    createExport(a, month, p.hash, false, randomUUID()),
  ).rejects.toThrow();
  const ex = await createExport(a, month, p.hash, true, randomUUID());
  const saved = (
    await db.query<ExportRow>("SELECT * FROM exports WHERE id=$1", [ex.id])
  ).rows[0];
  expect(saved.snapshot.format).toBe(2);
  expect(JSON.stringify(saved.snapshot)).not.toContain("private-draft-marker");
  const submitted = await saveRecord(
    s,
    {
      ...payload(draft, true),
      content: "public-submitted-marker",
      hours: "1",
      remark: "",
    },
    randomUUID(),
  );
  const h = await recordHistory(l, submitted.id);
  expect(JSON.stringify(h)).not.toContain("private-draft-marker");
  expect(JSON.stringify(h)).toContain("public-submitted-marker");
  expect(JSON.stringify(await recordHistory(s, submitted.id))).toContain(
    "private-draft-marker",
  );
});
it("管理员即使有学号和所属组仍不允许个人填报或被代录", async () => {
  await expect(workspace(a, month, "me")).rejects.toThrow();
  await expect(
    saveRecord(a, { ...payload(), hours: "1", submit: true }, randomUUID()),
  ).rejects.toThrow();
  await expect(
    saveRecord(
      l,
      {
        ...payload(),
        student_id: a.id,
        reason: "代录",
        hours: "1",
        submit: true,
      },
      randomUUID(),
    ),
  ).rejects.toThrow();
  expect((await team(a, 1)).some((u) => u.id === a.id)).toBe(false);
  await expect(
    saveRecord(
      l,
      {
        ...payload(),
        student_id: s.id,
        reason: "代录",
        hours: "1",
        submit: false,
      },
      randomUUID(),
    ),
  ).rejects.toThrow();
  const own = await saveRecord(
    l,
    { ...payload(), hours: "0", submit: true },
    randomUUID(),
  );
  expect(own.student_id).toBe(l.id);
});
it("退回保存不清原因，重提清当前原因且保留历史", async () => {
  let r = await saveRecord(
    s,
    { ...payload(), hours: "1", content: "待退回", submit: true },
    randomUUID(),
  );
  r = await reviewRecord(
    l,
    {
      id: r.id,
      month,
      revision: r.revision,
      action: "reject",
      reason: "请补充依据",
    },
    randomUUID(),
  );
  r = await saveRecord(
    s,
    { ...payload(r), hours: "1", content: "修改中" },
    randomUUID(),
  );
  expect(r.status).toBe("rejected");
  expect(r.reject_reason).toBe("请补充依据");
  r = await saveRecord(
    s,
    { ...payload(r, true), hours: "1", content: "正式重提" },
    randomUUID(),
  );
  expect(r.reject_reason).toBeNull();
  expect(JSON.stringify(await recordHistory(s, r.id))).toContain("请补充依据");
});

it("旧版本缓存的他人草稿保存/作废结果重放也拒绝", async () => {
  const draft = await saveRecord(s, payload(), randomUUID());
  const saveRequest = {
    month,
    group_id: 1,
    content: draft.content,
    hours: "",
    remark: draft.remark,
    id: draft.id,
    revision: draft.revision,
    submit: false,
  };
  const voidRequest = {
    id: draft.id,
    month,
    revision: draft.revision,
    action: "void",
    reason: "legacy void",
  };
  for (const [operation, request] of [
    ["save", saveRequest],
    ["review", voidRequest],
  ] as const) {
    const key = randomUUID();
    await db.query(
      "INSERT INTO idempotency_requests(actor_id,operation,key,request_hash,result) VALUES($1,$2,$3,$4,$5)",
      [
        l.id,
        operation,
        key,
        hash(JSON.stringify(request)),
        JSON.stringify(draft),
      ],
    );
    const call =
      operation === "save"
        ? saveRecord(l, request, key)
        : reviewRecord(l, request, key);
    await expect(call).rejects.toMatchObject({ status: 403 });
  }
});

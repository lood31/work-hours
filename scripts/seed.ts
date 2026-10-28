import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { getDB } from "../lib/db";
import { currentMonth } from "../lib/domain/model";
async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10)
    throw new Error("请设置至少10位的SEED_PASSWORD，不提供默认密码");
  const db = getDB();
  const pw = await bcrypt.hash(password, 12);
  const specs =
    process.env.SEED_DEMO === "true"
      ? ([
          ["admin", "总负责人", null, true, [1, 2, 3, 4, 5]],
          ["lead", "林知夏", "0000001001", false, [1, 2, 3, 4, 5]],
          ["0000001002", "陈星禾", "0000001002", false, [1, 3]],
          ["0000001003", "陈星禾", "0000001003", false, [2, 4, 5]],
        ] as const)
      : ([["admin", "总负责人", null, true, []]] as const);
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO periods(month) VALUES($1) ON CONFLICT DO NOTHING",
      [currentMonth()],
    );
    for (const [login, name, no, admin, groups] of specs) {
      const id = randomUUID();
      const created = (
        await tx.query<{ id: string }>(
          "INSERT INTO users(id,login,name,student_no,password_hash,is_admin) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(login) DO NOTHING RETURNING id",
          [id, login, name, no, pw, admin],
        )
      ).rows[0];
      if (!created) {
        console.log(`${login}: 已存在，未重置密码/权限`);
        continue;
      }
      for (const g of groups)
        await tx.query(
          "INSERT INTO memberships(user_id,group_id,is_reviewer) VALUES($1,$2,$3)",
          [id, g, login === "lead"],
        );
      if (login.startsWith("000"))
        for (const g of groups) {
          for (const [content, hours, remark] of [
            ["活动文案与内容整理", 80000, "示例记录，虚构数据"],
            ["车费折算", 20000, "车费50元÷25=2小时"],
            ["物料费折算", 12000, "物料费30元÷25=1.2小时"],
          ] as const)
            await tx.query(
              "INSERT INTO records(id,student_id,group_id,month,name,student_no,content,hours_units,remark,status,created_by,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$2,now())",
              [
                randomUUID(),
                id,
                g,
                currentMonth(),
                name,
                no,
                content,
                hours,
                remark,
              ],
            );
        }
      console.log(`${login}: 已创建`);
    }
  });
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromToken } from "../../lib/services/auth";
import { AppError } from "../../lib/domain/model";
import Workspace from "../../components/workspace";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page() {
  let actor;
  try {
    actor = await actorFromToken((await cookies()).get("session")?.value);
  } catch (error) {
    if (error instanceof AppError && error.status === 401) redirect("/login");
    return (
      <main className="setup">
        <p className="eyebrow">首次运行</p>
        <h1>先连接你的数据库</h1>
        <p>
          复制 .env.example 为 .env.local，本地设置 DB_DRIVER=pglite，然后运行：
        </p>
        <pre>
          npm run db:migrate
          <br />
          npm run db:seed
        </pre>
        <p>
          初始化账号需要在 .env.local 中设置至少10位的 SEED_PASSWORD。详见
          README。
        </p>
        <a className="button" href="/login">
          返回登录
        </a>
      </main>
    );
  }
  if (!actor) redirect("/login");
  return <Workspace actor={actor} />;
}

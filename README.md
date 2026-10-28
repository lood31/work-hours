# 工时簿 · 勤工俭学工时与费用汇总

试题一的三角色网页：统一填报、审核退回、按组核对、补报重审、月度Excel导出与版本追溯。
界面参考用户提供的 `minimalist-skill`，采用适合表单与数据审核的暖灰扁平布局，不使用营销页动画。

## 线上地址

<https://work-hours-puce.vercel.app>（Neon + Vercel）。总负责人 `admin` 默认进入月度总览，不参与个人填报。生产密码只在本机 `.env.deploy.local` 的 `SEED_PASSWORD`，与本地演示密码不同，勿提交环境文件。
最新修复与复验证据见 [本轮修复记录](docs/本轮修复记录.md)。旧导出保留原版式，重新生成的新版本采用修正后的Excel格式2。

## 现在就运行

本机已安装依赖、迁移本地数据库并初始化**虚构演示数据**。

```bash
npm run dev
```

打开 <http://localhost:3000>。

| 登录名 | 身份 |
| --- | --- |
| `admin` | 总负责人，可查看全组、导出、调整审核授权 |
| `lead` | 五组负责人，也具有学生身份；不能自审或审批本人代录 |
| `0000001002` | 学生：编辑组、文案组 |
| `0000001003` | 同名学生：视觉组、联络组、视频号 |

本地演示账号的随机密码保存在**本机 `.env.local` 的 `SEED_PASSWORD`**；未写入本文或源码，也不应提交该文件。
首次初始化后修改此变量不会重置已有账号密码，种子脚本不会覆盖既有用户。

## 换机器首次安装

建议 Node.js 24 LTS（至少22.16）、npm，已用Windows本机验证。

1. `npm ci`。
2. 复制 `.env.example` 为 `.env.local`。
3. 本地设置 `DB_DRIVER=pglite`，自行填写至少10位的 `SEED_PASSWORD`。
4. 需要虚构演示账号时设置 `SEED_DEMO=true`；否则只初始化 `admin`。
5. 依次运行：

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

PGlite是嵌入式PostgreSQL，数据持久化在 `.data/postgres`，不是浏览器localStorage；重启/登出不会清空。
停止应用后再迁移或运行种子脚本，避免两个进程同时打开同一个PGlite目录。

也可以直接使用独立开发Postgres：`DB_DRIVER=pg`，配置 `DATABASE_URL` 后运行相同迁移。

## 测试与构建

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
npm run sample
```

- Vitest：精度、汇总、状态、权限、真实嵌入式Postgres事务、并发、幂等、旧版、邀请、xlsx回读。
- Playwright：安装的Chrome（`channel: chrome`），独立 `.data/e2e-*` 数据库，3100端口；不会连接生产数据库。
  无Chrome时可安装Chrome，或把配置改为已安装的浏览器通道。运行前释放3100端口。
- E2E中部分审核/核对通过已登录浏览器上下文的HTTP请求执行，其余为页面交互；不是纯UI点击覆盖全部功能。
- `npm run sample`重新生成 `docs/虚构数据_2026-09_v1.xlsx`，五组且包含跨组、同名不同号和2.0004小时。
- `npm run format`格式化源码。迁移SQL不由Prettier处理，保持可审阅版本文件。

## 部署 Vercel + Neon

当前已完成部署；以下为在自己账号重建部署的步骤，不需要重复初始化现有生产数据：

1. 创建Neon数据库，保存**pooler连接串**（包含TLS参数）。
2. 在受信任终端为迁移进程配置 `DB_DRIVER=pg`、`DATABASE_URL`，运行 `npm run db:migrate`。
   初始化管理员时设置私有 `SEED_PASSWORD`、`SEED_DEMO=false` 后运行 `npm run db:seed`。
3. 上传代码到自己的私有仓库，不上传 `.env.local`、`.data`、`.tmp` 或真实个人数据。
4. Vercel导入项目，使用Next.js预设，配置 `DB_DRIVER=pg`、`DATABASE_URL`，`APP_URL`为正式HTTPS地址。
   生产**不需要**保存SEED_PASSWORD。Vercel已阻止PGlite启动，避免误用临时磁盘丢数据。
5. 同区域部署应用与Neon，确认连接数/执行时限/费用额度。Pool每实例最多3连接，不是整个Vercel项目只用3连接。
6. 完成生产登录、邀请、审核、导出、旧版下载冒烟。Preview环境用独立开发数据库，不连生产。

构建不会自动执行迁移。升级时审阅SQL、先备份，再单进程运行迁移；禁止通过删除历史表重建升级。

## 备份与恢复

- Neon/Postgres：按服务商能力启用备份/时间点恢复；也可使用受信任终端的 `pg_dump`（连接串只放环境变量），恢复到**新数据库**验证后再切换。
- 本地PGlite：停止应用后复制整个 `.data/postgres` 目录到明确的备份位置；恢复到新的 `PGLITE_PATH` 后启动核对，勿覆盖唯一原件。
- 导出版本保存在数据库的不可变快照内；仅下载xlsx不等于数据库备份。
- 不自动批量清理测试数据库目录；不再使用的 `.data/e2e-*` 由操作者确认后手动处理。

## 实现结构

- `lib/domain`：精度、结算、状态与差异纯逻辑。
- `lib/services`：授权、事务、幂等、修订和导出。
- `lib/db`：pg/PGlite连接及Drizzle连接适配；事务查询使用参数化SQL，明确保留行锁语义。
- `migrations`：可追踪SQL迁移；`scripts`：迁移、初始化、样例生成。
- `components`：三角色工作台、记录编辑/审核、导出及邀请授权。
- `tests`：自动化验证。

详情见 [操作说明](docs/操作说明.md)、[设计决策](docs/设计决策说明.md)、[验收记录](docs/验收记录.md)。

## 上线前仍需确认

工时4位精度、按组内个人结算的舍入粒度、自然月周期、单条200小时上限、组长薪酬标准。
已完成Neon/Vercel部署及线上功能冒烟；仍需真实手机、Excel/WPS GUI排版打印核对和负载测试。LibreOffice转换和自动化回读不能替代这些验证。

import AuthForm from "../../components/auth-form";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const p = await searchParams;
  return <AuthForm register token={p.token} />;
}

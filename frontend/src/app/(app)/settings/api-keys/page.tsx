import { PageBody } from "@/components/layout/PageBody";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ListGroup, ListRow } from "@/components/ui/List";
import { Panel } from "@/components/ui/Panel";
import { apiKeysRepository, apiKeyRefusal, canManageApiKeys, type ApiKey } from "@/features/apikeys";
import { NewApiKeyButton } from "@/features/apikeys/components/NewApiKeyButton";
import { RevokeApiKeyButton } from "@/features/apikeys/components/RevokeApiKeyButton";
import { ScopePills } from "@/features/apikeys/components/ScopePills";
import { getSession } from "@/features/workspace/session";
import { ApiError } from "@/lib/api/server";

/**
 * The workspace's API keys.
 *
 * The screen exists to remove one habit: wiring an integration up with a
 * person's own session token. That token is the person — it carries their role,
 * it dies when they leave, and nothing on any screen says which of the six
 * scripts in the company is using it. A key is the workspace's, it holds only
 * the scopes it was given, it has a name somebody chose, and it can be revoked
 * on its own without logging anybody out.
 *
 * Read here, written from the two client components below — a revoke reached
 * from a render would be spent by a prefetch.
 */

/** A read that answers "could not" rather than throwing — see the bot code screen. */
async function loadKeys(workspaceId: string): Promise<{ ok: true; value: ApiKey[] } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await apiKeysRepository.list(workspaceId) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, message: error.message };
    console.error("ApiKeysPage failed to load keys", error);
    return { ok: false, message: "Kalitlar ro'yxatini o'qib bo'lmadi." };
  }
}

export default async function ApiKeysPage() {
  const { workspace, role } = await getSession();
  const canManage = canManageApiKeys(role);
  const keys = await loadKeys(workspace.id);

  const all = keys.ok ? keys.value : [];
  const active = all.filter((item) => item.revokedAt === null);
  const revoked = all.filter((item) => item.revokedAt !== null);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Sozlamalar", href: "/settings" }, { label: "API kalitlari" }]}
        title="API kalitlari"
        subtitle={
          keys.ok
            ? `${workspace.name} · ${active.length} ta faol kalit`
            : workspace.name
        }
      />
      <PageBody maxWidth={820}>
        <div className="flex flex-col gap-6">
          <Panel className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="t-headline">Kalit bilan kirish</div>
                <p className="t-footnote t-secondary m-0 mt-1 max-w-[52ch] leading-[18px]">
                  Boshqa dastur yoki AI ish maydoni API&apos;siga shu kalit bilan kiradi — hech kimning shaxsiy
                  tokeni bilan emas. Kalit odamga emas, ish maydoniga tegishli: uni yaratgan odam jamoadan
                  chiqsa ham integratsiya ishlayveradi.
                </p>
              </div>
              <NewApiKeyButton canCreate={canManage} />
            </div>

            {!canManage && (
              <p className="t-footnote t-tertiary m-0 mt-3 flex items-start gap-2 leading-[18px]">
                <Icon name="info" size={14} className="mt-px flex-none" />
                {apiKeyRefusal(role)}
              </p>
            )}
          </Panel>

          {!keys.ok && (
            <Panel className="flex flex-col gap-1.5 p-4">
              <p className="t-body m-0">Kalitlar ro&apos;yxatini ochib bo&apos;lmadi</p>
              <p className="t-footnote t-secondary m-0">{keys.message}</p>
            </Panel>
          )}

          {keys.ok && all.length === 0 && (
            <Panel>
              <EmptyState
                icon="code"
                title="Hali kalit yaratilmagan"
                description="Birinchi kalitni yarating va uni ulanadigan dasturning sozlamasiga qo'ying."
              />
            </Panel>
          )}

          {active.length > 0 && (
            <ListGroup
              title="Faol kalitlar"
              footer="«Hali ishlatilmagan» yozuvi turgan kalitni hech narsa ishlatmayapti — uni bexavotir bekor qilsa bo'ladi."
            >
              {active.map((item) => (
                <ApiKeyRow key={item.id} apiKey={item} canManage={canManage} />
              ))}
            </ListGroup>
          )}

          {revoked.length > 0 && (
            <ListGroup
              title="Bekor qilingan"
              footer="Bekor qilingan kalit ro'yxatdan yo'qolmaydi. «Integratsiya nega to'xtadi» degan savolga javob beradigan yagona yozuv shu."
            >
              {revoked.map((item) => (
                <ApiKeyRow key={item.id} apiKey={item} canManage={canManage} />
              ))}
            </ListGroup>
          )}
        </div>
      </PageBody>
    </>
  );
}

/**
 * One key.
 *
 * Three lines, in the order the three questions get asked: which key is this,
 * what can it reach, and is anything still using it. The prefix sits beside the
 * name because a name is what somebody typed and a prefix is what is in the
 * configuration file — matching a row to a running integration needs the second
 * one.
 */
function ApiKeyRow({ apiKey, canManage }: { apiKey: ApiKey; canManage: boolean }) {
  const revoked = apiKey.revokedAt !== null;

  return (
    <ListRow className={revoked ? "opacity-60" : undefined}>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="t-body min-w-0 truncate">{apiKey.name}</span>
          <span className="t-footnote t-tertiary font-mono">{apiKey.prefix}</span>
          {revoked && <Badge tone="danger">Bekor qilingan</Badge>}
        </div>

        <ScopePills scopes={apiKey.scopes} />

        <span className="t-caption t-tertiary">
          {apiKey.createdBy} yaratgan · {apiKey.createdAt} ·{" "}
          {revoked
            ? `${apiKey.revokedAt} da bekor qilingan`
            : apiKey.lastUsedAt
              ? `oxirgi marta ${apiKey.lastUsedAt} ishlatilgan`
              : "hali ishlatilmagan"}
        </span>
      </div>

      {canManage && !revoked && (
        <RevokeApiKeyButton keyId={apiKey.id} name={apiKey.name} prefix={apiKey.prefix} />
      )}
    </ListRow>
  );
}

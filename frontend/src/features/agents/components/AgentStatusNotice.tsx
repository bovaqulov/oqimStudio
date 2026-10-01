import { Icon } from "@/components/ui/Icon";
import type { AgentStatus } from "../types";

/**
 * Whether an agent can actually answer on this deployment, said once at the
 * top of the screen.
 *
 * Three states, because there are three, and collapsing them would leave the
 * two that need doing something about looking like the one that does not:
 *
 *  · **not configured** — no API key. Agents can be written and saved; nothing
 *    will answer. The block fails cleanly into its exit, so a bot built on one
 *    keeps working, it just never gets a model reply — which is exactly the
 *    kind of half-working that is invisible without a line like this.
 *  · **offline** — the deliberate local mode. Everything works end to end and
 *    no request leaves the machine, so the reply is canned. Said out loud
 *    because "why is my agent answering `[oflayn] salom`" is otherwise an
 *    afternoon.
 *  · **ready** — nothing is drawn at all. A banner that says "working" on every
 *    load is a banner people stop reading, including on the days it changes.
 */
export function AgentStatusNotice({ status }: { status: AgentStatus }) {
  if (status.offline) {
    return (
      <div className="flex items-start gap-2.5 rounded-[12px] bg-warning-bg p-3 text-warning-fg">
        <Icon name="plugs" size={17} className="mt-[2px] flex-none" />
        <p className="t-footnote">
          <b>Oflayn rejim.</b> Modelga hech qanday so&apos;rov yuborilmaydi — agentlar tayyor javob qaytaradi
          («[oflayn] …»). Butun yo&apos;l ishlaydi, javob esa haqiqiy emas.
        </p>
      </div>
    );
  }

  if (!status.available) {
    return (
      <div className="flex items-start gap-2.5 rounded-[12px] bg-danger-bg p-3 text-danger-fg">
        <Icon name="warning" size={17} className="mt-[2px] flex-none" />
        <p className="t-footnote">
          <b>AI sozlanmagan.</b> {status.reason}. Agentni hozir ham yozib qo&apos;yish mumkin, lekin oqimdagi «AI
          agent» bloki javob bermaydi — u har safar «Tushunmadi» yoki «Operatorga» chiqishidan ketadi va
          buni suhbat tarixida yozib qoldiradi.
        </p>
      </div>
    );
  }

  return null;
}

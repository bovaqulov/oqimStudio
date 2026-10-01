import { Badge } from "@/components/ui/Badge";
import { describeScope } from "../scopes";

/**
 * What a key can reach, as a row of pills — the sentence and the token in the
 * same pill.
 *
 * Both halves are load-bearing and neither is decoration. Somebody auditing the
 * list is asking "may this reach my customers", which the words answer;
 * somebody wiring the key into their own code is asking "what do I put in the
 * config", which only `contacts:read` answers. Printing one and not the other
 * sends half the readers somewhere else to find out.
 */
export function ScopePills({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) {
    return <span className="t-footnote t-tertiary">Hech qanday ruxsat yo&apos;q</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {scopes.map((scope) => {
        const definition = describeScope(scope);
        // An unknown scope has no words of its own — it prints as itself, once,
        // rather than as the same string twice.
        const named = definition.short !== definition.key;
        return (
          <Badge key={scope} tone="neutral">
            {named && definition.short}
            <span className={named ? "ml-1.5 font-mono opacity-65" : "font-mono"}>{definition.key}</span>
          </Badge>
        );
      })}
    </div>
  );
}

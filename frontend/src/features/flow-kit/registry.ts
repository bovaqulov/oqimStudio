import type { ModuleKey } from "@/features/flows";
import { businessKit } from "./recipes/business";
import { channelsKit } from "./recipes/channels";
import { dmsKit } from "./recipes/dms";
import { groupsKit } from "./recipes/groups";
import { webappKit } from "./recipes/webapp";
import type { ModuleKit } from "./types";

/**
 * The five kits, in one place. Everything else — the wizard, the template
 * gallery, the graph builder, the server action — takes a `ModuleKit` and never
 * asks which module it came from (Open/Closed): a sixth surface is a sixth entry
 * here plus its recipe file, and no screen changes.
 */
const KITS: Record<ModuleKey, ModuleKit> = {
  business: businessKit,
  groups: groupsKit,
  channels: channelsKit,
  dms: dmsKit,
  webapp: webappKit,
};

export function getModuleKit(moduleKey: ModuleKey): ModuleKit {
  return KITS[moduleKey];
}

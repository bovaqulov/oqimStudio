"use client";

import { useRef } from "react";
import { Select } from "@/components/ui/Select";
import { ROLE_DEFINITIONS } from "../roles";
import type { MemberRole } from "../types";

/**
 * Role picker that saves on change. A separate "save" button per row would
 * turn a four-person team into eight clicks — the select *is* the action.
 */
export function MemberRoleSelect({
  value,
  disabled,
  title,
}: {
  value: MemberRole;
  disabled?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLSelectElement>(null);

  return (
    <Select
      ref={ref}
      name="role"
      defaultValue={value}
      disabled={disabled}
      title={title}
      aria-label="Rol"
      onChange={() => ref.current?.form?.requestSubmit()}
      className="w-[132px] py-1.5 text-[12px]"
    >
      {ROLE_DEFINITIONS.map((definition) => (
        <option key={definition.key} value={definition.key} disabled={definition.key === "owner"}>
          {definition.label}
        </option>
      ))}
    </Select>
  );
}

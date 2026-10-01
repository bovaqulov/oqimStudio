"use client";

import type { ButtonHTMLAttributes } from "react";
import { showToast } from "./toast-store";

export interface ToastButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  message: string;
}

/** For affordances that are real UI but have no backing feature yet (e.g. "connect a card") — acknowledges the click honestly instead of doing nothing or faking success. */
export function ToastButton({ message, onClick, ...rest }: ToastButtonProps) {
  return (
    <button
      type="button"
      onClick={(event) => {
        onClick?.(event);
        showToast(message);
      }}
      {...rest}
    />
  );
}

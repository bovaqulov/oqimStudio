"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { CreatedApiKey } from "../types";
import { CreateApiKeySheet } from "./CreateApiKeySheet";
import { RevealedKeySheet } from "./RevealedKeySheet";

/**
 * The trigger, and the two sheets it hands off to.
 *
 * Minting is two screens and not one because the second one has a job the first
 * cannot do: the credential comes back in the action's result and has to be put
 * somewhere the reader will act on it before it is gone. Swapping the sheet
 * rather than growing it means the form's fields — and the name that was typed
 * into them — are unmounted by then, so nothing on screen competes with the
 * only thing on it that matters.
 *
 * Both sheets are unmounted while closed rather than hidden. That is what
 * guarantees the secret is not sitting in a detached React tree after the
 * reader is done with it.
 *
 * The callbacks are `useCallback`ed on purpose: `Modal` registers its `onClose`
 * as the Escape and backdrop handler in an effect keyed on that identity, and a
 * fresh closure every render would tear the handler down and bounce focus out
 * of the sheet on every keystroke.
 */
export function NewApiKeyButton({ canCreate }: { canCreate: boolean }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  const closeForm = useCallback(() => setOpen(false), []);
  const onCreated = useCallback((key: CreatedApiKey) => setCreated(key), []);
  const finish = useCallback(() => {
    setCreated(null);
    setOpen(false);
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="primary"
        disabled={!canCreate}
        onClick={() => setOpen(true)}
        className="flex-none"
      >
        <Icon name="plus" size={16} />
        Yangi kalit
      </Button>

      {open && !created && <CreateApiKeySheet onCreated={onCreated} onClose={closeForm} />}
      {created && <RevealedKeySheet apiKey={created} onDone={finish} />}
    </>
  );
}

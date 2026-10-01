"use client";

import type { FlowNode, MessageContentKind } from "@/features/flows";
import {
  ALBUM_MIN_ITEMS,
  contentIssues,
  createAlbumItem,
  createPollConfig,
  getContentDefinition,
  nodeContentKind,
} from "../../../lib/message-content";
import { AlbumField } from "./AlbumField";
import { BodyField } from "./BodyField";
import { ContactField } from "./ContactField";
import { ContentIssues } from "./ContentIssues";
import { ContentKindField } from "./ContentKindField";
import { CopyMessageField } from "./CopyMessageField";
import { InvoiceField } from "./InvoiceField";
import { LocationField } from "./LocationField";
import { MediaSourceField } from "./MediaSourceField";
import { PollField } from "./PollField";
import { RevealPanel } from "./RevealPanel";
import { useBotMainLanguage } from "./TextLanguage";

const SAMPLE_TEXT = "Assalomu alaykum! Sizga qanday yordam bera olamiz?";
const SAMPLE_CAPTION = "Yangi mahsulotimiz — narxi va tafsilotlari uchun yozing.";

/**
 * Everything a "Xabar" block needs, as two questions: what it sends, and what
 * it says. Switching kinds keeps the other kinds' config around so flipping
 * back and forth is not destructive.
 *
 * Whatever the chosen kind takes — a file, poll options, a venue — sits inside
 * a reveal under the picker rather than beside it as a field of its own. It
 * exists only because of the choice above it, and reading it as a second
 * question is what made this block feel like a form instead of a message.
 */
export function MessageContentFields({
  node,
  onPatch,
}: {
  node: FlowNode;
  onPatch: (patch: Partial<FlowNode>) => void;
}) {
  const kind = nodeContentKind(node);
  const definition = getContentDefinition(kind);
  const caption = definition.bodyRole === "caption";
  const main = useBotMainLanguage();

  function selectKind(next: MessageContentKind) {
    const patch: Partial<FlowNode> = { contentKind: next };
    // Seed the kinds that are invalid while empty so the block starts at Telegram's minimum.
    if (next === "poll" && !node.poll) patch.poll = createPollConfig();
    if (next === "album" && !node.album?.length) {
      patch.album = Array.from({ length: ALBUM_MIN_ITEMS }, () => createAlbumItem());
    }
    onPatch(patch);
  }

  const config = definition.needsFile ? (
    <MediaSourceField
      label={definition.label}
      value={node.mediaSource}
      onChange={(mediaSource) => onPatch({ mediaSource })}
    />
  ) : kind === "poll" ? (
    <PollField value={node.poll} onChange={(poll) => onPatch({ poll })} />
  ) : kind === "location" ? (
    <LocationField value={node.location} onChange={(location) => onPatch({ location })} />
  ) : kind === "contact" ? (
    <ContactField value={node.contact} onChange={(contact) => onPatch({ contact })} />
  ) : kind === "invoice" ? (
    <InvoiceField value={node.invoice} onChange={(invoice) => onPatch({ invoice })} />
  ) : kind === "album" ? (
    <AlbumField items={node.album ?? []} onChange={(album) => onPatch({ album })} />
  ) : kind === "copy" ? (
    <CopyMessageField value={node.copyLink} onChange={(copyLink) => onPatch({ copyLink })} />
  ) : null;

  return (
    <>
      <ContentKindField value={kind} onChange={selectKind} />

      {config && <RevealPanel>{config}</RevealPanel>}

      {definition.bodyRole !== "none" && (
        <BodyField
          label={caption ? `${definition.label} ostidagi matn` : "Matn"}
          value={node.text}
          onChange={(text) => onPatch({ text })}
          sample={caption ? SAMPLE_CAPTION : SAMPLE_TEXT}
          markdown
        />
      )}

      <ContentIssues issues={contentIssues(node, main)} />
    </>
  );
}

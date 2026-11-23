import { useEffect, useRef, useState } from "preact/hooks";
import {
  connectFromSite,
  disconnectOwlbear,
  owlbearConnection,
  owlbearStore,
} from "../../integration/controller.ts";
import {
  EXTENSION_MANIFEST_PATH,
  extensionOrigin,
  owlbearRoomUrl,
  preferredExtensionAddress,
} from "../../../shared/obr/siteLink.ts";
import { toast } from "../../store.ts";

function savedConnectionField(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(`malice-menagerie/owlbear-${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function defaultManifestUrl(): string {
  const origin =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? window.location.origin
      : "https://malice-menagerie.pages.dev";
  return `${origin}${EXTENSION_MANIFEST_PATH}`;
}

export function OwlbearConnectForm() {
  const [room, setRoom] = useState(() => savedConnectionField("room"));
  const [extension, setExtension] = useState(() =>
    preferredExtensionAddress(
      savedConnectionField("extension"),
      owlbearStore.value.trustedOrigins,
      window.location.origin,
    ),
  );
  const [settingsOpen, setSettingsOpen] = useState(() => !extension);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<{
    field: "room" | "extension";
    message: string;
  } | null>(null);
  const roomInputRef = useRef<HTMLInputElement>(null);
  const extensionInputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== undefined) clearTimeout(copyTimerRef.current);
      if (focusTimerRef.current !== undefined) clearTimeout(focusTimerRef.current);
    };
  }, []);

  const manifestUrl = extension.trim() || defaultManifestUrl();
  const waiting = owlbearConnection.value.status === "connecting";

  const copyManifest = async () => {
    try {
      await navigator.clipboard.writeText(manifestUrl);
      setCopied(true);
      toast("Extension manifest URL copied.");
      if (copyTimerRef.current !== undefined) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = undefined;
        setCopied(false);
      }, 2_000);
    } catch {
      toast("Could not copy automatically — select the URL to copy it.");
    }
  };

  return (
    <form
      class="owlbear-connect"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const trimmedRoom = room.trim();
        const trimmedExtension = extension.trim();
        if (!owlbearRoomUrl(trimmedRoom)) {
          setFormError({
            field: "room",
            message: "Paste an Owlbear Rodeo room link (https://www.owlbear.rodeo/room/…).",
          });
          roomInputRef.current?.focus();
          return;
        }
        if (!extensionOrigin(trimmedExtension)) {
          setFormError({
            field: "extension",
            message: "Enter the HTTPS address where your Malice extension is hosted.",
          });
          setSettingsOpen(true);
          if (focusTimerRef.current !== undefined) clearTimeout(focusTimerRef.current);
          focusTimerRef.current = setTimeout(() => {
            focusTimerRef.current = undefined;
            extensionInputRef.current?.focus();
          }, 0);
          return;
        }
        setFormError(null);
        try {
          localStorage.setItem("malice-menagerie/owlbear-room", trimmedRoom);
          localStorage.setItem("malice-menagerie/owlbear-extension", trimmedExtension);
        } catch {
          /* Remembering addresses is optional. */
        }
        connectFromSite(trimmedRoom, trimmedExtension);
      }}
    >
      <div class="owlbear-install">
        <span class="owlbear-install-label">1. Install in Owlbear Rodeo</span>
        <div class="owlbear-manifest-row">
          <code class="owlbear-origin" title={manifestUrl}>
            {manifestUrl}
          </code>
          <button
            class="secondary compact-button"
            type="button"
            onClick={() => void copyManifest()}
          >
            {copied ? "Copied" : "Copy URL"}
          </button>
        </div>
        <p class="owlbear-hint small">
          In Owlbear Rodeo, open Extensions → Add Custom Extension, paste this URL, and enable it in
          your room.
        </p>
      </div>
      <label class="owlbear-field">
        <span>2. Owlbear room link</span>
        <input
          ref={roomInputRef}
          type="url"
          required
          value={room}
          disabled={waiting}
          spellcheck={false}
          aria-invalid={formError?.field === "room" ? "true" : undefined}
          aria-describedby={formError?.field === "room" ? "owlbear-connect-error" : undefined}
          placeholder="https://www.owlbear.rodeo/room/…"
          onInput={(event) => {
            setRoom(event.currentTarget.value);
            if (formError?.field === "room") setFormError(null);
          }}
        />
      </label>
      <details
        class="owlbear-section"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary>Connection settings</summary>
        <label class="owlbear-field">
          <span>Extension address</span>
          <input
            ref={extensionInputRef}
            type="url"
            required
            value={extension}
            disabled={waiting}
            spellcheck={false}
            aria-invalid={formError?.field === "extension" ? "true" : undefined}
            aria-describedby={
              formError?.field === "extension" ? "owlbear-connect-error" : undefined
            }
            placeholder={defaultManifestUrl()}
            onInput={(event) => {
              setExtension(event.currentTarget.value);
              if (formError?.field === "extension") setFormError(null);
            }}
          />
        </label>
        <p class="owlbear-hint small">Use the manifest URL you installed in Owlbear Rodeo.</p>
      </details>
      {formError ? (
        <p id="owlbear-connect-error" class="owlbear-error" role="alert">
          {formError.message}
        </p>
      ) : null}
      <div class="owlbear-actions">
        <button class="primary" type="submit" disabled={waiting}>
          {waiting ? "Connecting…" : "Connect to room"}
        </button>
        {waiting ? (
          <button class="secondary" type="button" onClick={() => void disconnectOwlbear()}>
            Cancel
          </button>
        ) : null}
      </div>
      <p class="owlbear-hint">
        Opens your room in a new tab. Keep both tabs open; the connection can recover after a
        refresh. The Malice extension must be enabled in that room.
      </p>
      <p class="owlbear-hint small">
        Already playing in another room tab? You can still press Connect in its Malice extension.
      </p>
    </form>
  );
}
